import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eventEnvelopeSchema, eventPayloadSchemas, eventTypes } from '@funtino/event-contracts';
import type { EventBus } from '@funtino/backend-core';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../persistence/prisma/prisma.service.js';

export const DEVICE_EVENT_BUS = Symbol('DEVICE_EVENT_BUS');
export const DEVICE_RABBIT_URL = Symbol('DEVICE_RABBIT_URL');
const batchSize = 25;
const leaseMilliseconds = 60_000;
const maxAttempts = 12;
const maxRetryDelayMilliseconds = 5 * 60_000;

type ClaimedEvent = {
  id: string;
  eventType: string;
  aggregateId: string;
  envelope: unknown;
  attempts: number;
  leaseToken: string;
};

const ownedEventTypes = new Set<string>([
  eventTypes.deviceTransactionImported,
  eventTypes.deviceRegistered,
  eventTypes.deviceUpdated,
  eventTypes.deviceHealthObserved,
]);

@Injectable()
export class DeviceOutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceOutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEVICE_EVENT_BUS) private readonly eventBus: EventBus,
    @Inject(DEVICE_RABBIT_URL) private readonly rabbitUrl: string | undefined,
  ) {}

  onModuleInit(): void {
    if (!this.rabbitUrl) {
      this.logger.warn('RabbitMQ is not configured; device events remain in the durable outbox.');
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
          envelope.data.sourceId !== 'device-integration' ||
          !ownedEventTypes.has(envelope.data.eventType)
        ) {
          if (await this.deadLetter(row, 'INVALID_ENVELOPE')) counts.deadLettered += 1;
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
          const deadLettered = row.attempts + 1 >= maxAttempts;
          const delay = Math.min(1_000 * 2 ** row.attempts, maxRetryDelayMilliseconds);
          const update = await this.prisma.outboxEvent.updateMany({
            where: { id: row.id, leaseToken: row.leaseToken },
            data: {
              attempts: { increment: 1 },
              availableAt: new Date(Date.now() + delay),
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
          this.logger.warn('Device event publish failed; delivery is scheduled for retry.');
        }
      }
    } catch {
      this.logger.error('Device outbox batch could not be processed.');
    } finally {
      this.running = false;
    }
    if (counts.deadLettered > 0) {
      this.logger.error(`Device outbox dead-lettered ${counts.deadLettered} event(s).`);
    }
    return counts;
  }

  private claimBatch(): Promise<ClaimedEvent[]> {
    const leaseToken = randomUUID();
    return this.prisma.$transaction(
      (tx) => tx.$queryRaw<ClaimedEvent[]>`
        WITH candidates AS (
          SELECT id FROM device_integration.outbox_events
          WHERE published_at IS NULL AND dead_lettered_at IS NULL AND available_at <= CURRENT_TIMESTAMP
            AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
          ORDER BY created_at, id LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
        )
        UPDATE device_integration.outbox_events AS event
        SET lease_token = ${leaseToken}::uuid,
            lease_expires_at = CURRENT_TIMESTAMP + (${leaseMilliseconds} * INTERVAL '1 millisecond')
        FROM candidates WHERE event.id = candidates.id
        RETURNING event.id, event.event_type AS "eventType", event.aggregate_id AS "aggregateId",
                  event.envelope, event.attempts, event.lease_token AS "leaseToken"
      `,
    );
  }

  private async deadLetter(row: ClaimedEvent, errorCode: string): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: row.id, leaseToken: row.leaseToken },
      data: {
        deadLetteredAt: new Date(),
        lastErrorCode: errorCode,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    return result.count > 0;
  }
}
