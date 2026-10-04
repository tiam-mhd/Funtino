import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eventEnvelopeSchema, eventPayloadSchemas, eventTypes } from '@funtino/event-contracts';
import {
  createSafeErrorDiagnostic,
  type EventBus,
  writeStructuredLog,
} from '@funtino/backend-core';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../persistence/prisma/prisma.service.js';

export const ORGANIZATION_BRANCH_EVENT_BUS = Symbol('ORGANIZATION_BRANCH_EVENT_BUS');
export const ORGANIZATION_BRANCH_RABBIT_URL = Symbol('ORGANIZATION_BRANCH_RABBIT_URL');
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
const OWNED_EVENT_TYPES = new Set<string>([
  eventTypes.organizationCreated,
  eventTypes.organizationUpdated,
  eventTypes.organizationStatusChanged,
  eventTypes.branchCreated,
  eventTypes.branchUpdated,
  eventTypes.branchStatusChanged,
]);

@Injectable()
export class OrganizationBranchOutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORGANIZATION_BRANCH_EVENT_BUS) private readonly eventBus: EventBus,
    @Inject(ORGANIZATION_BRANCH_RABBIT_URL) private readonly rabbitUrl: string | undefined,
  ) {}

  onModuleInit(): void {
    if (!this.rabbitUrl) {
      writeStructuredLog({
        level: 'warn',
        event: 'dependency.disabled',
        service: 'organization-branch',
        component: 'OrganizationBranchOutboxRelayService.onModuleInit',
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

  async flushOnce() {
    const counts = { claimed: 0, published: 0, retried: 0, deadLettered: 0 };
    const deliveryFailures: Array<{
      eventId: string;
      eventType: string;
      stage: string;
      attempt: number;
      correlationId: string;
      error: unknown;
    }> = [];
    if (!this.rabbitUrl || this.running) return counts;
    this.running = true;
    let stage = 'claim_batch';
    try {
      const rows = await this.claimBatch();
      counts.claimed = rows.length;
      stage = 'process_batch';
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
          envelope.data.sourceId !== 'organization-branch' ||
          !OWNED_EVENT_TYPES.has(envelope.data.eventType)
        ) {
          if (await this.deadLetter(row, 'INVALID_ENVELOPE')) {
            counts.deadLettered += 1;
            writeStructuredLog({
              level: 'error',
              event: 'outbox.envelope.invalid',
              service: 'organization-branch',
              component: 'OrganizationBranchOutboxRelayService.flushOnce',
              stage: 'envelope_validation',
              eventId: envelope.success ? envelope.data.eventId : row.id,
              ...(envelope.success ? { eventType: envelope.data.eventType } : {}),
              error: envelope.success
                ? { type: 'OutboxInvariantError', code: 'OUTBOX_ENVELOPE_MISMATCH' }
                : createSafeErrorDiagnostic(envelope.error),
            });
          }
          continue;
        }
        let deliveryStage = 'rabbitmq_publish';
        try {
          await this.eventBus.publish(envelope.data);
          deliveryStage = 'postgresql_ack';
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
        } catch (error) {
          deliveryFailures.push({
            eventId: envelope.data.eventId,
            eventType: envelope.data.eventType,
            stage: deliveryStage,
            attempt: row.attempts + 1,
            correlationId: envelope.data.correlationId,
            error,
          });
          const deadLettered = row.attempts + 1 >= MAX_ATTEMPTS;
          const delay = Math.min(1_000 * 2 ** row.attempts, MAX_RETRY_DELAY_MS);
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
        }
      }
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'outbox.batch_failed',
        service: 'organization-branch',
        component: 'OrganizationBranchOutboxRelayService.flushOnce',
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
        level: counts.deadLettered > 0 ? 'error' : 'warn',
        event: 'outbox.delivery.batch_failed',
        service: 'organization-branch',
        component: 'OrganizationBranchOutboxRelayService.flushOnce',
        stage: 'per_event_delivery',
        dependency: 'rabbitmq_or_postgresql',
        failureCount: deliveryFailures.length,
        retriedCount: counts.retried,
        deadLetteredCount: counts.deadLettered,
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
    return counts;
  }

  private claimBatch(): Promise<ClaimedEvent[]> {
    const leaseToken = randomUUID();
    return this.prisma.$transaction(
      (tx) => tx.$queryRaw<ClaimedEvent[]>`
      WITH candidates AS (
        SELECT id FROM organization_branch.outbox_events
        WHERE published_at IS NULL AND dead_lettered_at IS NULL AND available_at <= CURRENT_TIMESTAMP
          AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at, id LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
      )
      UPDATE organization_branch.outbox_events AS event
      SET lease_token = ${leaseToken}::uuid,
          lease_expires_at = CURRENT_TIMESTAMP + (${LEASE_MS} * INTERVAL '1 millisecond')
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
