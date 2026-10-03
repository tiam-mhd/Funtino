import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eventEnvelopeSchema, eventPayloadSchemas, eventTypes } from '@funtino/event-contracts';
import type { EventBus } from '@funtino/backend-core';
import { randomUUID } from 'node:crypto';
import { createSafeErrorDiagnostic } from '../../bootstrap/startup-failure.js';
import { PrismaService } from '../persistence/prisma/prisma.service.js';

export const CUSTOMER_HOUSEHOLD_EVENT_BUS = Symbol('CUSTOMER_HOUSEHOLD_EVENT_BUS');
export const CUSTOMER_HOUSEHOLD_RABBIT_URL = Symbol('CUSTOMER_HOUSEHOLD_RABBIT_URL');
const ownEvents = new Set<string>([eventTypes.householdCreated, eventTypes.householdMemberCreated]);

@Injectable()
export class CustomerHouseholdOutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustomerHouseholdOutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CUSTOMER_HOUSEHOLD_EVENT_BUS) private readonly eventBus: EventBus,
    @Inject(CUSTOMER_HOUSEHOLD_RABBIT_URL) private readonly rabbitUrl: string | undefined,
  ) {}

  onModuleInit(): void {
    if (!this.rabbitUrl) {
      this.logger.warn(
        'RabbitMQ is not configured; customer-household events remain in the outbox.',
      );
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
    if (!this.rabbitUrl || this.running)
      return { claimed: 0, published: 0, retried: 0, deadLettered: 0 };
    this.running = true;
    const counts = { claimed: 0, published: 0, retried: 0, deadLettered: 0 };
    try {
      const rows = await this.claimBatch();
      counts.claimed = rows.length;
      for (const row of rows) {
        const envelope = eventEnvelopeSchema.safeParse(row.envelope);
        const payloadSchema = envelope.success
          ? eventPayloadSchemas[envelope.data.eventType as keyof typeof eventPayloadSchemas]
          : undefined;
        if (
          !envelope.success ||
          !payloadSchema?.safeParse(envelope.data.payload).success ||
          envelope.data.eventId !== row.id ||
          envelope.data.eventType !== row.eventType ||
          envelope.data.aggregateId !== row.aggregateId ||
          envelope.data.sourceId !== 'customer-household' ||
          !ownEvents.has(envelope.data.eventType)
        ) {
          if (await this.deadLetter(row)) counts.deadLettered += 1;
          continue;
        }
        try {
          await this.eventBus.publish(envelope.data);
          const ack = await this.prisma.outboxEvent.updateMany({
            where: { id: row.id, leaseToken: row.leaseToken },
            data: {
              publishedAt: new Date(),
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
            },
          });
          if (ack.count) counts.published += 1;
        } catch {
          const deadLettered = row.attempts + 1 >= 12;
          const delayMs = Math.min(1_000 * 2 ** row.attempts, 300_000);
          const update = await this.prisma.outboxEvent.updateMany({
            where: { id: row.id, leaseToken: row.leaseToken },
            data: {
              attempts: { increment: 1 },
              availableAt: new Date(Date.now() + delayMs),
              ...(deadLettered ? { deadLetteredAt: new Date() } : {}),
              lastErrorCode: 'PUBLISH_FAILED',
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (update.count) {
            if (deadLettered) counts.deadLettered += 1;
            else counts.retried += 1;
          }
          this.logger.warn(
            'Customer-household event publish failed; delivery is scheduled for retry.',
          );
        }
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'outbox.batch_failed',
          service: 'customer-household',
          error: createSafeErrorDiagnostic(error),
        }),
      );
    } finally {
      this.running = false;
    }
    return counts;
  }

  private claimBatch() {
    const leaseToken = randomUUID();
    return this.prisma.$transaction(
      (tx) => tx.$queryRaw<
        Array<{
          id: string;
          eventType: string;
          aggregateId: string;
          envelope: unknown;
          attempts: number;
          leaseToken: string;
        }>
      >`
      WITH candidates AS (
        SELECT id FROM customer_household.outbox_events
        WHERE published_at IS NULL AND dead_lettered_at IS NULL AND available_at <= CURRENT_TIMESTAMP
          AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at, id LIMIT 25 FOR UPDATE SKIP LOCKED
      )
      UPDATE customer_household.outbox_events AS event
      SET lease_token = ${leaseToken}::uuid,
          lease_expires_at = CURRENT_TIMESTAMP + (60000 * INTERVAL '1 millisecond')
      FROM candidates WHERE event.id = candidates.id
      RETURNING event.id, event.event_type AS "eventType", event.aggregate_id AS "aggregateId",
                event.envelope, event.attempts, event.lease_token AS "leaseToken"
    `,
    );
  }

  private async deadLetter(row: { id: string; leaseToken: string }) {
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: row.id, leaseToken: row.leaseToken },
      data: {
        deadLetteredAt: new Date(),
        lastErrorCode: 'INVALID_ENVELOPE',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    return result.count > 0;
  }
}
