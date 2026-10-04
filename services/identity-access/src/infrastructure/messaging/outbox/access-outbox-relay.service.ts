import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { identityPolicyChangedEventSchema } from '@funtino/event-contracts';
import {
  createSafeErrorDiagnostic,
  type EventBus,
  writeStructuredLog,
} from '@funtino/backend-core';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../persistence/prisma/prisma.service.js';

export const ACCESS_EVENT_BUS = Symbol('ACCESS_EVENT_BUS');
export const ACCESS_RABBIT_URL = Symbol('ACCESS_RABBIT_URL');

const BATCH_SIZE = 25;
const LEASE_DURATION_MS = 60_000;
const MAX_ATTEMPTS = 12;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

type ClaimedOutboxRow = {
  id: string;
  auditLogId: string;
  envelope: unknown;
  attempts: number;
  leaseToken: string;
};

export type OutboxFlushResult = {
  claimed: number;
  published: number;
  retried: number;
  deadLettered: number;
};

@Injectable()
export class AccessOutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCESS_EVENT_BUS) private readonly eventBus: EventBus,
    @Inject(ACCESS_RABBIT_URL) private readonly rabbitUrl: string | undefined,
  ) {}

  onModuleInit(): void {
    if (!this.rabbitUrl) {
      writeStructuredLog({
        level: 'warn',
        event: 'dependency.disabled',
        service: 'identity-access',
        component: 'AccessOutboxRelayService.onModuleInit',
        stage: 'outbox_publisher_configuration',
        dependency: 'rabbitmq',
        deliveryMode: 'durable_outbox_only',
      });
      return;
    }
    this.timer = setInterval(() => void this.flushOnce(), 2_000);
    void this.flushOnce();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.eventBus.close();
  }

  async flushOnce(): Promise<OutboxFlushResult> {
    const result: OutboxFlushResult = { claimed: 0, published: 0, retried: 0, deadLettered: 0 };
    if (!this.rabbitUrl || this.running) return result;

    this.running = true;
    const deliveryFailures: Array<{
      eventId: string;
      eventType: string;
      stage: string;
      attempt: number;
      correlationId: string;
      error: unknown;
    }> = [];
    let stage = 'claim_batch';
    try {
      const rows = await this.claimBatch();
      result.claimed = rows.length;
      stage = 'process_batch';

      for (const row of rows) {
        const parsedEvent = identityPolicyChangedEventSchema.safeParse(row.envelope);
        if (
          !parsedEvent.success ||
          parsedEvent.data.eventId !== row.id ||
          parsedEvent.data.payload.auditId !== row.auditLogId ||
          parsedEvent.data.payload.targetId !== parsedEvent.data.aggregateId
        ) {
          if (await this.deadLetter(row)) {
            result.deadLettered += 1;
            writeStructuredLog({
              level: 'error',
              event: 'outbox.envelope.invalid',
              service: 'identity-access',
              component: 'AccessOutboxRelayService.flushOnce',
              stage: 'envelope_validation',
              eventId: parsedEvent.success ? parsedEvent.data.eventId : row.id,
              error: parsedEvent.success
                ? { type: 'OutboxInvariantError', code: 'OUTBOX_ENVELOPE_MISMATCH' }
                : createSafeErrorDiagnostic(parsedEvent.error),
            });
          }
          continue;
        }

        let deliveryStage = 'rabbitmq_publish';
        try {
          await this.eventBus.publish(parsedEvent.data);
          deliveryStage = 'postgresql_ack';
          const acknowledgement = await this.prisma.outboxEvent.updateMany({
            where: { id: row.id, leaseToken: row.leaseToken },
            data: {
              publishedAt: new Date(),
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
            },
          });
          if (acknowledgement.count > 0) result.published += 1;
        } catch (error) {
          deliveryFailures.push({
            eventId: parsedEvent.data.eventId,
            eventType: parsedEvent.data.eventType,
            stage: deliveryStage,
            attempt: row.attempts + 1,
            correlationId: parsedEvent.data.correlationId,
            error,
          });
          const retry = await this.scheduleRetry(row);
          if (retry.updated) {
            if (retry.deadLettered) result.deadLettered += 1;
            else result.retried += 1;
          }
        }
      }
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'outbox.batch_failed',
        service: 'identity-access',
        component: 'AccessOutboxRelayService.flushOnce',
        stage,
        dependency: 'postgresql_or_rabbitmq',
        error: createSafeErrorDiagnostic(error),
        priorDeliveryFailureCount: deliveryFailures.length,
        ...(deliveryFailures.length
          ? {
              priorDeliveryFailures: deliveryFailures.slice(0, 5).map((failure) => ({
                eventId: failure.eventId,
                eventType: failure.eventType,
                stage: failure.stage,
                attempt: failure.attempt,
                correlationId: failure.correlationId,
                error: createSafeErrorDiagnostic(failure.error),
              })),
            }
          : {}),
      });
    } finally {
      this.running = false;
    }
    if (deliveryFailures.length > 0) {
      writeStructuredLog({
        level: result.deadLettered > 0 ? 'error' : 'warn',
        event: 'outbox.delivery.batch_failed',
        service: 'identity-access',
        component: 'AccessOutboxRelayService.flushOnce',
        stage: 'per_event_delivery',
        dependency: 'rabbitmq_or_postgresql',
        failureCount: deliveryFailures.length,
        retriedCount: result.retried,
        deadLetteredCount: result.deadLettered,
        failures: deliveryFailures.slice(0, 5).map((failure) => ({
          eventId: failure.eventId,
          eventType: failure.eventType,
          stage: failure.stage,
          attempt: failure.attempt,
          correlationId: failure.correlationId,
          error: createSafeErrorDiagnostic(failure.error),
        })),
      });
    }
    return result;
  }

  private async claimBatch(): Promise<ClaimedOutboxRow[]> {
    const leaseToken = randomUUID();
    return this.prisma.$transaction(
      (tx) =>
        tx.$queryRaw<ClaimedOutboxRow[]>`
        WITH candidates AS (
          SELECT id
          FROM identity_access.outbox_events
          WHERE published_at IS NULL
            AND dead_lettered_at IS NULL
            AND available_at <= CURRENT_TIMESTAMP
            AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
          ORDER BY created_at, id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE identity_access.outbox_events AS event
        SET lease_token = ${leaseToken}::uuid,
            lease_expires_at = CURRENT_TIMESTAMP + (${LEASE_DURATION_MS} * INTERVAL '1 millisecond')
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.id, event.audit_log_id AS "auditLogId", event.envelope, event.attempts,
                  event.lease_token AS "leaseToken"
      `,
    );
  }

  private async deadLetter(row: ClaimedOutboxRow): Promise<boolean> {
    const update = await this.prisma.outboxEvent.updateMany({
      where: { id: row.id, leaseToken: row.leaseToken },
      data: {
        deadLetteredAt: new Date(),
        lastErrorCode: 'INVALID_ENVELOPE',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    return update.count > 0;
  }

  private async scheduleRetry(
    row: ClaimedOutboxRow,
  ): Promise<{ updated: boolean; deadLettered: boolean }> {
    const attempts = row.attempts + 1;
    const deadLettered = attempts >= MAX_ATTEMPTS;
    const delay = Math.min(1_000 * 2 ** Math.max(row.attempts, 0), MAX_RETRY_DELAY_MS);
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
    return { updated: update.count > 0, deadLettered: deadLettered && update.count > 0 };
  }
}
