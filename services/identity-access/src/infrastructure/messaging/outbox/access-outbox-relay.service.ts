import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { identityPolicyChangedEventSchema } from '@funtino/event-contracts';
import type { EventBus } from '@funtino/backend-core';
import { randomUUID } from 'node:crypto';
import { createSafeErrorDiagnostic } from '../../../bootstrap/startup-failure.js';
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
  private readonly logger = new Logger(AccessOutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCESS_EVENT_BUS) private readonly eventBus: EventBus,
    @Inject(ACCESS_RABBIT_URL) private readonly rabbitUrl: string | undefined,
  ) {}

  onModuleInit(): void {
    if (!this.rabbitUrl) {
      this.logger.warn('RabbitMQ is not configured; access events remain pending in the outbox.');
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
    try {
      const rows = await this.claimBatch();
      result.claimed = rows.length;

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
            this.logger.error(
              'Invalid access event envelope moved to the service dead-letter state.',
            );
          }
          continue;
        }

        try {
          await this.eventBus.publish(parsedEvent.data);
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
        } catch {
          const retry = await this.scheduleRetry(row);
          if (retry.updated) {
            if (retry.deadLettered) result.deadLettered += 1;
            else result.retried += 1;
            this.logger.warn(
              'Access event publish failed; delivery will be retried or dead-lettered.',
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'outbox.batch_failed',
          service: 'identity-access',
          error: createSafeErrorDiagnostic(error),
        }),
      );
    } finally {
      this.running = false;
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
