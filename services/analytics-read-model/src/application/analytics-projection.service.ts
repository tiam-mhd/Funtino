import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eventTypes } from '@funtino/event-contracts';
import type {
  DeviceHealthState,
  DeviceLifecycleStatus,
  Prisma,
  ResourceStatus,
} from '../../generated/prisma/index.js';
import {
  parseAnalyticsEvent,
  parseArchivedAnalyticsEvent,
  type SanitizedAnalyticsEvent,
} from '../domain/reporting/analytics-event.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

const projectionLock = 2_048_610_01;
const eventBatchSize = 500;
const rebuildLeaseMilliseconds = 60_000;

type Transaction = Prisma.TransactionClient;

@Injectable()
export class AnalyticsProjectionService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async initialize(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${projectionLock})`;
      await tx.projectionControl.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
      await tx.rebuildLease.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
      const control = await tx.projectionControl.findUniqueOrThrow({ where: { id: 1 } });
      if (control.activeGenerationId) return;

      const generationId = randomUUID();
      await tx.projectionGeneration.create({
        data: {
          id: generationId,
          status: 'active',
          activatedAt: new Date(),
          completedAt: new Date(),
          highWatermark: 0n,
        },
      });
      await tx.projectionControl.update({
        where: { id: 1 },
        data: { activeGenerationId: generationId },
      });
    });
  }

  async markConsumerCoverageStarted(): Promise<void> {
    const startedAt = new Date();
    await this.prisma.projectionControl.updateMany({
      where: { id: 1, coverageStartedAt: null },
      data: { coverageStartedAt: startedAt },
    });
  }

  async ingest(input: unknown): Promise<'processed' | 'ignored' | 'duplicate'> {
    const event = parseAnalyticsEvent(input);
    if (!event) return 'ignored';

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${projectionLock})`;
      const inserted = await tx.analyticsEvent.createMany({
        data: [
          {
            eventId: event.eventId,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            sourceId: event.sourceId,
            aggregateId: event.aggregateId,
            organizationId: event.organizationId,
            branchId: event.branchId,
            payload: event.payload as Prisma.InputJsonValue,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return 'duplicate';

      const control = await tx.projectionControl.findUniqueOrThrow({ where: { id: 1 } });
      if (!control.activeGenerationId) throw new Error('ANALYTICS_PROJECTION_NOT_INITIALIZED');
      await applyEvent(tx, control.activeGenerationId, event);
      const now = new Date();
      await tx.projectionControl.update({
        where: { id: 1 },
        data: {
          coverageStartedAt: control.coverageStartedAt ?? now,
          lastEventAt:
            !control.lastEventAt || event.occurredAt > control.lastEventAt
              ? event.occurredAt
              : control.lastEventAt,
          lastProcessedAt: now,
        },
      });
      return 'processed';
    });
  }

  /** Rebuild into a new generation; catch-up uses bounded transactions that briefly serialize ingestion. */
  async rebuild(): Promise<{
    generationId: string;
    replayedEvents: number;
    highWatermark: string;
  }> {
    await this.initialize();
    const leaseId = randomUUID();
    const now = new Date();
    const lease = await this.prisma.rebuildLease.updateMany({
      where: { id: 1, OR: [{ expiresAt: null }, { expiresAt: { lte: now } }] },
      data: { leaseId, expiresAt: new Date(now.getTime() + rebuildLeaseMilliseconds) },
    });
    if (lease.count !== 1) throw new ConflictException('ANALYTICS_REBUILD_ALREADY_RUNNING');

    const generationId = randomUUID();
    let replayedEvents = 0;
    let generationCreated = false;
    try {
      await this.prisma.projectionGeneration.create({
        data: { id: generationId, status: 'building' },
      });
      generationCreated = true;
      const highWatermark =
        (await this.prisma.analyticsEvent.aggregate({ _max: { sequence: true } }))._max.sequence ??
        0n;
      let cursor = 0n;
      while (cursor < highWatermark) {
        const batch = await this.prisma.analyticsEvent.findMany({
          where: { sequence: { gt: cursor, lte: highWatermark } },
          orderBy: { sequence: 'asc' },
          take: eventBatchSize,
        });
        if (batch.length === 0) throw new Error('ANALYTICS_REBUILD_EVENT_GAP');
        await this.prisma.$transaction(
          async (tx) => {
            await assertAndRenewLease(tx, leaseId);
            for (const archived of batch) {
              await applyEvent(tx, generationId, parseArchivedAnalyticsEvent(archived));
            }
            await tx.projectionGeneration.update({
              where: { id: generationId },
              data: { highWatermark: batch.at(-1)!.sequence },
            });
          },
          { maxWait: 2_000, timeout: 30_000 },
        );
        cursor = batch.at(-1)!.sequence;
        replayedEvents += batch.length;
      }

      let completedWatermark = highWatermark;
      while (true) {
        const result = await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${projectionLock})`;
            await assertAndRenewLease(tx, leaseId);
            const latest =
              (await tx.analyticsEvent.aggregate({ _max: { sequence: true } }))._max.sequence ?? 0n;
            if (latest > cursor) {
              const batch = await tx.analyticsEvent.findMany({
                where: { sequence: { gt: cursor, lte: latest } },
                orderBy: { sequence: 'asc' },
                take: eventBatchSize,
              });
              if (batch.length === 0) throw new Error('ANALYTICS_REBUILD_EVENT_GAP');
              for (const archived of batch) {
                await applyEvent(tx, generationId, parseArchivedAnalyticsEvent(archived));
              }
              const nextCursor = batch.at(-1)!.sequence;
              await tx.projectionGeneration.update({
                where: { id: generationId },
                data: { highWatermark: nextCursor },
              });
              await assertAndRenewLease(tx, leaseId);
              return { cutover: false as const, cursor: nextCursor, count: batch.length };
            }

            const control = await tx.projectionControl.findUniqueOrThrow({ where: { id: 1 } });
            if (control.activeGenerationId) {
              await tx.projectionGeneration.updateMany({
                where: { id: control.activeGenerationId, status: 'active' },
                data: { status: 'superseded' },
              });
            }
            await tx.projectionGeneration.update({
              where: { id: generationId },
              data: {
                status: 'active',
                highWatermark: latest,
                activatedAt: new Date(),
                completedAt: new Date(),
              },
            });
            await tx.projectionControl.update({
              where: { id: 1 },
              data: { activeGenerationId: generationId, lastProcessedAt: new Date() },
            });
            await tx.rebuildLease.updateMany({
              where: { id: 1, leaseId },
              data: { leaseId: null, expiresAt: null },
            });
            return { cutover: true as const, cursor: latest, count: 0 };
          },
          { maxWait: 2_000, timeout: 30_000 },
        );

        if (result.cutover) {
          completedWatermark = result.cursor;
          break;
        }
        cursor = result.cursor;
        completedWatermark = cursor;
        replayedEvents += result.count;
      }

      return { generationId, replayedEvents, highWatermark: completedWatermark.toString() };
    } catch (error) {
      if (generationCreated) {
        await this.prisma.projectionGeneration
          .updateMany({
            where: { id: generationId, status: 'building' },
            data: { status: 'failed', lastErrorCode: 'REBUILD_FAILED', completedAt: new Date() },
          })
          .catch(() => undefined);
      }
      throw error;
    } finally {
      await this.prisma.rebuildLease
        .updateMany({
          where: { id: 1, leaseId },
          data: { leaseId: null, expiresAt: null },
        })
        .catch(() => undefined);
    }
  }
}

async function assertAndRenewLease(tx: Transaction, leaseId: string): Promise<void> {
  const now = new Date();
  const lease = await tx.rebuildLease.findUnique({ where: { id: 1 } });
  if (lease?.leaseId !== leaseId || !lease.expiresAt || lease.expiresAt <= now) {
    throw new ConflictException('ANALYTICS_REBUILD_LEASE_LOST');
  }
  const renewed = await tx.rebuildLease.updateMany({
    where: { id: 1, leaseId, expiresAt: { gt: now } },
    data: { expiresAt: new Date(now.getTime() + rebuildLeaseMilliseconds) },
  });
  if (renewed.count !== 1) throw new ConflictException('ANALYTICS_REBUILD_LEASE_LOST');
}

async function applyEvent(tx: Transaction, generationId: string, event: SanitizedAnalyticsEvent) {
  const payload = event.payload;
  const version = typeof payload.version === 'number' ? payload.version : 0;

  if (
    event.eventType === eventTypes.organizationCreated ||
    event.eventType === eventTypes.organizationUpdated ||
    event.eventType === eventTypes.organizationStatusChanged
  ) {
    const id = String(payload.id);
    const current = await tx.organizationProjection.findUnique({
      where: { generationId_id: { generationId, id } },
    });
    if (!current || version > current.version) {
      await tx.organizationProjection.upsert({
        where: { generationId_id: { generationId, id } },
        create: {
          generationId,
          id,
          name: typeof payload.name === 'string' ? payload.name : null,
          status: payload.status as ResourceStatus,
          version,
          updatedAt: event.occurredAt,
        },
        update: {
          ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
          status: payload.status as ResourceStatus,
          version,
          updatedAt: event.occurredAt,
        },
      });
    }
    return;
  }

  if (
    event.eventType === eventTypes.branchCreated ||
    event.eventType === eventTypes.branchUpdated ||
    event.eventType === eventTypes.branchStatusChanged
  ) {
    const id = String(payload.id);
    const current = await tx.branchProjection.findUnique({
      where: { generationId_id: { generationId, id } },
    });
    if (!current || version > current.version) {
      await tx.branchProjection.upsert({
        where: { generationId_id: { generationId, id } },
        create: {
          generationId,
          id,
          organizationId: event.organizationId,
          name: typeof payload.name === 'string' ? payload.name : null,
          status: payload.status as ResourceStatus,
          version,
          updatedAt: event.occurredAt,
        },
        update: {
          organizationId: event.organizationId,
          ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
          status: payload.status as ResourceStatus,
          version,
          updatedAt: event.occurredAt,
        },
      });
    }
    if (event.eventType === eventTypes.branchCreated) {
      await incrementMetric(tx, generationId, event, 'branch.created', event.occurredAt);
    } else if (event.eventType === eventTypes.branchStatusChanged) {
      await incrementMetric(tx, generationId, event, 'branch.status_changed', event.occurredAt);
    }
    return;
  }

  const id = String(payload.id);
  const current = await tx.deviceProjection.findUnique({
    where: { generationId_id: { generationId, id } },
  });
  if (
    event.eventType === eventTypes.deviceRegistered ||
    event.eventType === eventTypes.deviceUpdated
  ) {
    if (!current || version > current.version) {
      await tx.deviceProjection.upsert({
        where: { generationId_id: { generationId, id } },
        create: {
          generationId,
          id,
          organizationId: event.organizationId,
          branchId: event.branchId!,
          displayName: String(payload.displayName),
          deviceType: String(payload.deviceType),
          status: payload.status as DeviceLifecycleStatus,
          version,
          updatedAt: event.occurredAt,
        },
        update: {
          organizationId: event.organizationId,
          branchId: event.branchId!,
          displayName: String(payload.displayName),
          deviceType: String(payload.deviceType),
          status: payload.status as DeviceLifecycleStatus,
          version,
          updatedAt: event.occurredAt,
        },
      });
    }
    await incrementMetric(
      tx,
      generationId,
      event,
      event.eventType === eventTypes.deviceRegistered ? 'device.registered' : 'device.updated',
      event.occurredAt,
    );
    return;
  }

  const isLatest = payload.isLatest === true;
  const observedAt = new Date(String(payload.observedAt));
  if (
    isLatest &&
    !Number.isNaN(observedAt.valueOf()) &&
    (!current?.latestObservedAt || observedAt >= current.latestObservedAt)
  ) {
    await tx.deviceProjection.upsert({
      where: { generationId_id: { generationId, id } },
      create: {
        generationId,
        id,
        organizationId: event.organizationId,
        branchId: event.branchId!,
        displayName: null,
        deviceType: null,
        status: null,
        latestHealth: payload.reportedState as DeviceHealthState,
        latestObservedAt: observedAt,
        version: 0,
        updatedAt: event.occurredAt,
      },
      update: {
        organizationId: event.organizationId,
        branchId: event.branchId!,
        latestHealth: payload.reportedState as DeviceHealthState,
        latestObservedAt: observedAt,
        updatedAt: event.occurredAt,
      },
    });
  }
  const state = String(payload.reportedState);
  await incrementMetric(tx, generationId, event, `device.health.${state}`, observedAt);
}

async function incrementMetric(
  tx: Transaction,
  generationId: string,
  event: SanitizedAnalyticsEvent,
  metricKey: string,
  occurredAt: Date,
) {
  if (!event.branchId || Number.isNaN(occurredAt.valueOf())) return;
  const day = new Date(
    Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), occurredAt.getUTCDate()),
  );
  await tx.dailyOperationalMetric.upsert({
    where: {
      generationId_day_organizationId_branchId_metricKey: {
        generationId,
        day,
        organizationId: event.organizationId,
        branchId: event.branchId,
        metricKey,
      },
    },
    create: {
      generationId,
      day,
      organizationId: event.organizationId,
      branchId: event.branchId,
      metricKey,
      count: 1,
    },
    update: { count: { increment: 1 } },
  });
}
