import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eventEnvelopeSchema, eventPayloadSchemas, eventTypes } from '@funtino/event-contracts';
import { createSafeErrorDiagnostic, type EventBus, writeStructuredLog } from '@funtino/backend-core';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../persistence/prisma/prisma.service.js';

export const FORMS_EVENT_BUS = Symbol('FORMS_EVENT_BUS');
export const FORMS_RABBIT_URL = Symbol('FORMS_RABBIT_URL');
const OWNED_EVENT_TYPES = new Set<string>([
  eventTypes.formPublished,
  eventTypes.formPaused,
  eventTypes.formResponseSubmitted,
  eventTypes.formResponseStatusChanged,
]);
const BATCH_SIZE = 25;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 12;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

type ClaimedEvent = {
  id: string;
  eventType: string;
  aggregateId: string;
  envelope: unknown;
  attempts: number;
  leaseToken: string;
};

@Injectable()
export class FormsOutboxRelay implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FORMS_EVENT_BUS) private readonly eventBus: EventBus,
    @Inject(FORMS_RABBIT_URL) private readonly rabbitUrl: string | undefined,
  ) {}

  onModuleInit(): void {
    if (!this.rabbitUrl) {
      writeStructuredLog({ level: 'warn', event: 'dependency.disabled', service: 'forms', component: 'FormsOutboxRelay.onModuleInit', stage: 'outbox_publisher_configuration', dependency: 'rabbitmq', deliveryMode: 'durable_outbox_only' });
      return;
    }
    this.timer = setInterval(() => void this.flushOnce(), 2_000);
    void this.flushOnce();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.eventBus.close();
  }

  async flushOnce() {
    const counts = { claimed: 0, published: 0, retried: 0, deadLettered: 0 };
    if (!this.rabbitUrl || this.running) return counts;
    this.running = true;
    try {
      const rows = await this.claimBatch();
      counts.claimed = rows.length;
      for (const row of rows) {
        const parsed = eventEnvelopeSchema.safeParse(row.envelope);
        const payloadSchema = parsed.success
          ? eventPayloadSchemas[parsed.data.eventType as keyof typeof eventPayloadSchemas]
          : undefined;
        if (!parsed.success || !payloadSchema?.safeParse(parsed.data.payload).success ||
          parsed.data.eventId !== row.id || parsed.data.eventType !== row.eventType ||
          parsed.data.aggregateId !== row.aggregateId || parsed.data.sourceId !== 'forms' ||
          !OWNED_EVENT_TYPES.has(parsed.data.eventType)) {
          if (await this.deadLetter(row, 'INVALID_ENVELOPE')) counts.deadLettered += 1;
          writeStructuredLog({
            level: 'error', event: 'outbox.envelope.invalid', service: 'forms',
            component: 'FormsOutboxRelay.flushOnce', stage: 'envelope_validation', eventId: row.id,
            error: parsed.success ? { type: 'OutboxInvariantError', code: 'OUTBOX_ENVELOPE_MISMATCH' } : createSafeErrorDiagnostic(parsed.error),
          });
          continue;
        }
        try {
          await this.eventBus.publish(parsed.data);
          const ack = await this.prisma.outboxEvent.updateMany({
            where: { id: row.id, leaseToken: row.leaseToken },
            data: { publishedAt: new Date(), leaseToken: null, leaseExpiresAt: null, lastErrorCode: null },
          });
          if (ack.count) counts.published += 1;
        } catch (error) {
          const deadLettered = row.attempts + 1 >= MAX_ATTEMPTS;
          const delay = Math.min(1_000 * 2 ** row.attempts, MAX_RETRY_DELAY_MS);
          const update = await this.prisma.outboxEvent.updateMany({
            where: { id: row.id, leaseToken: row.leaseToken },
            data: {
              attempts: { increment: 1 }, availableAt: new Date(Date.now() + delay),
              ...(deadLettered ? { deadLetteredAt: new Date() } : {}),
              lastErrorCode: 'PUBLISH_FAILED', leaseToken: null, leaseExpiresAt: null,
            },
          });
          if (update.count) {
            if (deadLettered) counts.deadLettered += 1;
            else counts.retried += 1;
          }
          writeStructuredLog({
            level: deadLettered ? 'error' : 'warn', event: 'outbox.delivery.failed', service: 'forms',
            component: 'FormsOutboxRelay.flushOnce', stage: 'rabbitmq_publish', eventId: row.id,
            eventType: row.eventType, attempt: row.attempts + 1, error: createSafeErrorDiagnostic(error),
          });
        }
      }
    } catch (error) {
      writeStructuredLog({ level: 'error', event: 'outbox.batch_failed', service: 'forms', component: 'FormsOutboxRelay.flushOnce', stage: 'claim_or_process', dependency: 'postgresql_or_rabbitmq', error: createSafeErrorDiagnostic(error) });
    } finally {
      this.running = false;
    }
    return counts;
  }

  private claimBatch(): Promise<ClaimedEvent[]> {
    const leaseToken = randomUUID();
    return this.prisma.$transaction((tx) => tx.$queryRaw<ClaimedEvent[]>`
      WITH candidates AS (
        SELECT id FROM forms.outbox_events
        WHERE published_at IS NULL AND dead_lettered_at IS NULL AND available_at <= CURRENT_TIMESTAMP
          AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at, id LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
      )
      UPDATE forms.outbox_events AS event
      SET lease_token = ${leaseToken}::uuid,
          lease_expires_at = CURRENT_TIMESTAMP + (${LEASE_MS} * INTERVAL '1 millisecond')
      FROM candidates WHERE event.id = candidates.id
      RETURNING event.id, event.event_type AS "eventType", event.aggregate_id AS "aggregateId",
                event.envelope, event.attempts, event.lease_token AS "leaseToken"
    `);
  }

  private async deadLetter(row: ClaimedEvent, errorCode: string): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: row.id, leaseToken: row.leaseToken },
      data: { deadLetteredAt: new Date(), lastErrorCode: errorCode, leaseToken: null, leaseExpiresAt: null },
    });
    return result.count > 0;
  }
}
