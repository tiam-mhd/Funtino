import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import { createSafeErrorDiagnostic, writeStructuredLog } from '@funtino/backend-core';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type Device as PrismaDevice, type EdgeInstallation as PrismaEdgeInstallation } from '../../../../generated/prisma/index.js';
import type {
  DeviceListQuery,
  DeviceListResult,
  DeviceMutationResult,
  DeviceRegistryRepository,
  HealthObservationResult,
  ImportTransactionCommand,
  EdgeInstallationRecord,
  EdgeTransactionEvent,
  RegisterDeviceCommand,
  ReportHealthCommand,
  TransactionImportResult,
  UpdateDeviceCommand,
  DeviceCommandMeta,
} from '../../../application/ports/device-registry.repository.js';
import type { DeviceRecord } from '../../../domain/device/device.js';
import { PrismaService } from './prisma.service.js';

type StoredResponse<T> = { result: T };

@Injectable()
export class PrismaDeviceRegistryRepository implements DeviceRegistryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findIdempotentMutation(
    operation: 'device.register' | 'device.update',
    command: RegisterDeviceCommand | UpdateDeviceCommand,
    meta: DeviceCommandMeta,
  ): Promise<DeviceMutationResult | null> {
    const requestHash = hash({ operation, command, actorUserId: meta.actorUserId });
    const replay = await this.readIdempotency<DeviceMutationResult>(meta, requestHash);
    return replay.found ? replay.result : null;
  }

  async registerDevice(
    command: RegisterDeviceCommand,
    meta: DeviceCommandMeta,
  ): Promise<DeviceMutationResult> {
    const requestHash = hash({
      operation: 'device.register',
      command,
      actorUserId: meta.actorUserId,
    });
    return this.executeIdempotent(meta, requestHash, async (tx) => {
      const row = await tx.device.create({
        data: {
          organizationId: command.organizationId,
          branchId: command.branchId,
          adapterKey: command.adapterKey,
          externalDeviceId: command.externalDeviceId,
          displayName: command.displayName,
          deviceType: command.deviceType,
          status: 'active',
        },
      });
      const result = { deviceId: row.id, status: row.status, version: row.version };
      const envelope = createEventEnvelope({
        eventType: eventTypes.deviceRegistered,
        sourceId: 'device-integration',
        aggregateId: row.id,
        organizationId: row.organizationId,
        branchId: row.branchId,
        correlationId: meta.correlationId,
        payload: {
          deviceId: row.id,
          deviceType: row.deviceType,
          displayName: row.displayName,
          status: 'active',
          version: row.version,
        },
      });
      await this.writeAudit(
        tx,
        row,
        meta,
        'device.registered',
        null,
        auditSnapshot(row),
        command.reason ?? null,
      );
      await this.writeOutbox(tx, envelope);
      return result;
    });
  }

  async updateDevice(
    command: UpdateDeviceCommand,
    meta: DeviceCommandMeta,
  ): Promise<DeviceMutationResult> {
    const requestHash = hash({
      operation: 'device.update',
      command,
      actorUserId: meta.actorUserId,
    });
    return this.executeIdempotent(meta, requestHash, async (tx) => {
      const before = await tx.device.findFirst({
        where: {
          id: command.deviceId,
          organizationId: command.organizationId,
          branchId: command.branchId,
        },
      });
      if (!before) throw new NotFoundException('Device not found.');
      if (before.version !== command.expectedVersion)
        throw new ConflictException('Device version is stale; reload before retrying.');

      const displayName = command.displayName ?? before.displayName;
      const status = command.status ?? before.status;
      if (displayName === before.displayName && status === before.status) {
        return { deviceId: before.id, status: before.status, version: before.version };
      }

      const updated = await tx.device.updateMany({
        where: {
          id: before.id,
          organizationId: command.organizationId,
          branchId: command.branchId,
          version: command.expectedVersion,
        },
        data: { displayName, status, version: { increment: 1 }, updatedAt: new Date() },
      });
      if (!updated.count) throw new ConflictException('Device changed concurrently; reload it.');
      const after = await tx.device.findUniqueOrThrow({ where: { id: before.id } });
      const result = { deviceId: after.id, status: after.status, version: after.version };
      const envelope = createEventEnvelope({
        eventType: eventTypes.deviceUpdated,
        sourceId: 'device-integration',
        aggregateId: after.id,
        organizationId: after.organizationId,
        branchId: after.branchId,
        correlationId: meta.correlationId,
        payload: {
          deviceId: after.id,
          deviceType: after.deviceType,
          displayName: after.displayName,
          status: after.status,
          version: after.version,
        },
      });
      await this.writeAudit(
        tx,
        after,
        meta,
        'device.updated',
        auditSnapshot(before),
        auditSnapshot(after),
        command.reason ?? null,
      );
      await this.writeOutbox(tx, envelope);
      return result;
    });
  }

  async listDevices(query: DeviceListQuery): Promise<DeviceListResult> {
    const rows = await this.prisma.device.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.pageSize + 1,
    });
    const hasMore = rows.length > query.pageSize;
    const items = rows.slice(0, query.pageSize).map(mapRecord);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async getDevice(
    organizationId: string,
    deviceId: string,
    branchId?: string,
  ): Promise<DeviceRecord> {
    const row = await this.prisma.device.findFirst({
      where: { id: deviceId, organizationId, ...(branchId ? { branchId } : {}) },
    });
    if (!row) throw new NotFoundException('Device not found.');
    return mapRecord(row);
  }

  async recordHealthObservation(command: ReportHealthCommand): Promise<HealthObservationResult> {
    const key = {
      organizationId_adapterKey_externalDeviceId: {
        organizationId: command.organizationId,
        adapterKey: command.adapterKey,
        externalDeviceId: command.externalDeviceId,
      },
    };
    const device = await this.prisma.device.findUnique({ where: key });
    if (!device) throw new NotFoundException('Registered device not found.');

    const requestHash = hash({
      organizationId: command.organizationId,
      adapterKey: command.adapterKey,
      externalDeviceId: command.externalDeviceId,
      externalObservationId: command.externalObservationId,
      reportedState: command.reportedState,
      observedAt: command.observedAt.toISOString(),
    });
    const existing = await this.prisma.deviceHealthObservation.findUnique({
      where: {
        deviceId_externalObservationId: {
          deviceId: device.id,
          externalObservationId: command.externalObservationId,
        },
      },
    });
    if (existing) return this.replayHealthObservation(existing, requestHash, device.id);
    if (device.status !== 'active') throw new ConflictException('Device is not active.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.device.findUnique({ where: { id: device.id } });
        if (!current || current.status !== 'active')
          throw new ConflictException('Device is not active.');

        const observationId = randomUUID();
        const applied = await tx.device.updateMany({
          where: {
            id: device.id,
            status: 'active',
            OR: [{ latestObservedAt: null }, { latestObservedAt: { lt: command.observedAt } }],
          },
          data: {
            latestReportedState: command.reportedState,
            latestObservedAt: command.observedAt,
            updatedAt: new Date(),
          },
        });
        const isLatest = applied.count > 0;
        if (!isLatest) {
          const stillActive = await tx.device.findFirst({
            where: { id: device.id, status: 'active' },
            select: { id: true },
          });
          if (!stillActive) throw new ConflictException('Device is not active.');
        }
        await tx.deviceHealthObservation.create({
          data: {
            id: observationId,
            deviceId: device.id,
            externalObservationId: command.externalObservationId,
            requestHash,
            reportedState: command.reportedState,
            observedAt: command.observedAt,
            correlationId: command.correlationId,
            appliedAsLatest: isLatest,
          },
        });
        const envelope = createEventEnvelope({
          eventType: eventTypes.deviceHealthObserved,
          sourceId: 'device-integration',
          aggregateId: device.id,
          organizationId: device.organizationId,
          branchId: device.branchId,
          correlationId: command.correlationId,
          payload: {
            deviceId: device.id,
            observationId,
            reportedState: command.reportedState,
            observedAt: command.observedAt.toISOString(),
            isLatest,
          },
        });
        await this.writeOutbox(tx, envelope);
        return {
          accepted: true,
          duplicate: false,
          deviceId: device.id,
          observationId,
          observedAt: command.observedAt.toISOString(),
          isLatest,
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await this.prisma.deviceHealthObservation.findUnique({
        where: {
          deviceId_externalObservationId: {
            deviceId: device.id,
            externalObservationId: command.externalObservationId,
          },
        },
      });
      if (duplicate) return this.replayHealthObservation(duplicate, requestHash, device.id);
      throw new ConflictException('Device health observation conflicts with existing data.');
    }
  }

  async importTransactionEvent(
    command: ImportTransactionCommand,
    correlationId: string,
  ): Promise<TransactionImportResult> {
    const requestHash = hash({ ...command, occurredAt: command.occurredAt.toISOString() });
    const existing = await this.prisma.deviceTransactionImport.findUnique({
      where: { externalEventId: command.externalEventId },
    });
    if (existing) return this.replayTransactionImport(existing, requestHash);

    const transactionId = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        let deviceId: string | null = null;
        if (command.sourceDeviceId) {
          const candidates = await tx.device.findMany({
            where: {
              organizationId: command.organizationId,
              branchId: command.branchId,
              externalDeviceId: command.sourceDeviceId,
            },
            select: { id: true, status: true },
            take: 2,
          });
          if (candidates.length !== 1 || candidates[0]?.status !== 'active') {
            throw new ConflictException('Source device is not uniquely registered and active in this branch.');
          }
          deviceId = candidates[0].id;
        }
        await tx.deviceTransactionImport.create({
          data: {
            externalEventId: command.externalEventId,
            transactionId,
            requestHash,
            organizationId: command.organizationId,
            branchId: command.branchId,
            sourceDeviceId: command.sourceDeviceId ?? null,
            deviceId,
          },
        });
        const envelope = createEventEnvelope({
          eventType: eventTypes.deviceTransactionImported,
          sourceId: 'device-integration',
          aggregateId: transactionId,
          organizationId: command.organizationId,
          branchId: command.branchId,
          correlationId,
          payload: {
            transactionId,
            externalEventId: command.externalEventId,
            externalCardId: command.externalCardId,
            ...(deviceId ? { deviceId } : {}),
            ...(command.sourceDeviceId ? { sourceDeviceId: command.sourceDeviceId } : {}),
            transactionKind: command.transactionKind,
            amountMinor: command.amountMinor,
            currency: command.currency,
            occurredAt: command.occurredAt.toISOString(),
          },
        });
        await this.writeOutbox(tx, envelope);
        return {
          accepted: true,
          duplicate: false,
          externalEventId: command.externalEventId,
          transactionId,
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await this.prisma.deviceTransactionImport.findUnique({
        where: { externalEventId: command.externalEventId },
      });
      if (duplicate) return this.replayTransactionImport(duplicate, requestHash);
      throw new ConflictException('Device transaction event conflicts with existing data.');
    }
  }

  async getEdgeInstallation(sourceInstanceId: string): Promise<EdgeInstallationRecord | null> {
    const row = await this.prisma.edgeInstallation.findUnique({ where: { sourceInstanceId } });
    return row ? mapEdgeInstallation(row) : null;
  }

  registerEdgeInstallation(
    input: { sourceInstanceId: string; organizationId: string; branchId: string; currentKeyId: string },
    meta: DeviceCommandMeta,
  ): Promise<EdgeInstallationRecord> {
    const requestHash = hash({ operation: 'edge.installation.register', input, actor: meta.actorUserId });
    return this.executeIdempotent(meta, requestHash, async (tx) => {
      const row = await tx.edgeInstallation.create({
        data: {
          sourceInstanceId: input.sourceInstanceId,
          organizationId: input.organizationId,
          branchId: input.branchId,
          currentKeyId: input.currentKeyId,
        },
      });
      await tx.edgeInstallationAudit.create({
        data: {
          id: randomUUID(),
          sourceInstanceId: row.sourceInstanceId,
          organizationId: row.organizationId,
          branchId: row.branchId,
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'registered',
          correlationId: meta.correlationId,
          after: { status: row.status, version: row.version, currentKeyId: row.currentKeyId },
        },
      });
      return mapEdgeInstallation(row);
    });
  }

  rotateEdgeInstallationKey(
    input: { sourceInstanceId: string; currentKeyId: string; expectedVersion: number },
    meta: DeviceCommandMeta,
  ): Promise<EdgeInstallationRecord> {
    const requestHash = hash({ operation: 'edge.installation.rotate-key', input, actor: meta.actorUserId });
    return this.executeIdempotent(meta, requestHash, async (tx) => {
      const current = await tx.edgeInstallation.findUnique({ where: { sourceInstanceId: input.sourceInstanceId } });
      if (!current) throw new NotFoundException('Edge installation not found.');
      if (current.status !== 'active' || current.version !== input.expectedVersion)
        throw new ConflictException('Edge installation changed; reload before retrying.');
      if (current.currentKeyId === input.currentKeyId)
        throw new ConflictException('A different key identifier is required for rotation.');
      const updated = await tx.edgeInstallation.updateMany({
        where: { sourceInstanceId: input.sourceInstanceId, version: input.expectedVersion, status: 'active' },
        data: {
          previousKeyId: current.currentKeyId,
          currentKeyId: input.currentKeyId,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (!updated.count) throw new ConflictException('Edge installation changed; reload before retrying.');
      const row = await tx.edgeInstallation.findUniqueOrThrow({ where: { sourceInstanceId: input.sourceInstanceId } });
      await tx.edgeInstallationAudit.create({
        data: {
          id: randomUUID(),
          sourceInstanceId: row.sourceInstanceId,
          organizationId: row.organizationId,
          branchId: row.branchId,
          actorUserId: meta.actorUserId,
          callerService: meta.callerService,
          action: 'key_rotated',
          correlationId: meta.correlationId,
          before: { version: current.version, currentKeyId: current.currentKeyId },
          after: { version: row.version, currentKeyId: row.currentKeyId, previousKeyId: row.previousKeyId },
        },
      });
      return mapEdgeInstallation(row);
    });
  }

  async consumeEdgeRateLimit(input: {
    sourceInstanceId: string;
    windowStartedAt: Date;
    limit: number;
  }): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ request_count: number }>>`
      INSERT INTO "device_integration"."edge_rate_limits"
        ("source_instance_id", "window_started_at", "request_count", "updated_at")
      VALUES (${input.sourceInstanceId}::uuid, ${input.windowStartedAt}::timestamptz, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("source_instance_id", "window_started_at")
      DO UPDATE SET "request_count" = "edge_rate_limits"."request_count" + 1,
                    "updated_at" = CURRENT_TIMESTAMP
      WHERE "edge_rate_limits"."request_count" < ${input.limit}
      RETURNING "request_count"
    `;
    return rows.length === 1;
  }

  async importEdgeTransactionEvent(
    event: EdgeTransactionEvent,
    correlationId: string,
  ): Promise<'accepted' | 'duplicate'> {
    const initialHash = hash(stableStringify(event));
    const existing = await this.prisma.edgeTransactionImport.findUnique({ where: { eventId: event.eventId } });
    if (existing) {
      if (existing.requestHash.trim() !== initialHash)
        throw new ConflictException('Event identifier conflicts with an existing payload.');
      return 'duplicate';
    }
    const installation = await this.prisma.edgeInstallation.findUnique({ where: { sourceInstanceId: event.sourceInstanceId } });
    if (!installation || installation.status !== 'active' || installation.organizationId !== event.organizationId || installation.branchId !== event.branchId)
      throw new ConflictException('Edge installation scope is invalid.');

    let deviceId = event.deviceId;
    if (deviceId) {
      const device = await this.prisma.device.findFirst({
        where: { id: deviceId, organizationId: event.organizationId, branchId: event.branchId, status: 'active' },
        select: { id: true, externalDeviceId: true },
      });
      if (!device || (event.sourceDeviceId && device.externalDeviceId !== event.sourceDeviceId))
        throw new ConflictException('Device identity is not active in the event branch.');
    } else if (event.sourceDeviceId) {
      const candidates = await this.prisma.device.findMany({
        where: { organizationId: event.organizationId, branchId: event.branchId, externalDeviceId: event.sourceDeviceId, status: 'active' },
        select: { id: true },
        take: 2,
      });
      if (candidates.length !== 1)
        throw new ConflictException('Source device does not resolve uniquely in the event branch.');
      deviceId = candidates[0].id;
    } else {
      throw new ConflictException('A registered device identity is required.');
    }

    const canonicalEvent = { ...event, deviceId };
    const requestHash = initialHash;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.edgeTransactionImport.create({
          data: {
            eventId: canonicalEvent.eventId,
            sourceInstanceId: canonicalEvent.sourceInstanceId,
            localTransactionId: canonicalEvent.localTransactionId,
            localSequence: BigInt(canonicalEvent.localSequence),
            requestHash,
            organizationId: canonicalEvent.organizationId,
            branchId: canonicalEvent.branchId,
            eventPayload: canonicalEvent as unknown as Prisma.InputJsonValue,
          },
        });
        if (canonicalEvent.operationResult === 'success') {
          const envelope = createEventEnvelope({
            eventType: eventTypes.deviceEdgeTransactionImported,
            sourceId: 'device-integration',
            aggregateId: canonicalEvent.cardId,
            organizationId: canonicalEvent.organizationId,
            branchId: canonicalEvent.branchId,
            correlationId,
            payload: canonicalEvent,
          });
          await this.writeOutbox(tx, envelope);
        }
        await tx.edgeInstallation.update({
          where: { sourceInstanceId: canonicalEvent.sourceInstanceId },
          data: { lastHeartbeatAt: new Date(), updatedAt: new Date() },
        });
      });
      return 'accepted';
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await this.prisma.edgeTransactionImport.findUnique({ where: { eventId: canonicalEvent.eventId } });
      if (duplicate && duplicate.requestHash.trim() === requestHash) return 'duplicate';
      throw new ConflictException('Event identifier, transaction ID or sequence conflicts with existing data.');
    }
  }

  async findTransactionImportReplay(
    command: ImportTransactionCommand,
  ): Promise<TransactionImportResult | null> {
    const existing = await this.prisma.deviceTransactionImport.findUnique({
      where: { externalEventId: command.externalEventId },
    });
    if (!existing) return null;
    return this.replayTransactionImport(
      existing,
      hash({ ...command, occurredAt: command.occurredAt.toISOString() }),
    );
  }

  async isReady(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'service.readiness.failed',
        service: 'device-integration',
        component: 'PrismaDeviceRegistryRepository.isReady',
        stage: 'database_probe',
        dependency: 'postgresql',
        error: createSafeErrorDiagnostic(error),
      });
      throw new ServiceUnavailableException('Device registry database is unavailable.');
    }
  }

  private async executeIdempotent<T extends object>(
    meta: DeviceCommandMeta,
    requestHash: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const previous = await this.readIdempotency<T>(meta, requestHash);
    if (previous.found) return previous.result;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.idempotencyCommand.create({
          data: {
            callerService: meta.callerService,
            key: meta.idempotencyKey,
            requestHash,
            response: { result: {} },
          },
        });
        const result = await work(tx);
        await tx.idempotencyCommand.update({
          where: {
            callerService_key: { callerService: meta.callerService, key: meta.idempotencyKey },
          },
          data: { response: { result } as Prisma.InputJsonValue },
        });
        return result;
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const duplicate = await this.readIdempotency<T>(meta, requestHash);
      if (duplicate.found) return duplicate.result;
      throw new ConflictException('Device identity or command key is already in use.');
    }
  }

  private async readIdempotency<T>(
    meta: DeviceCommandMeta,
    requestHash: string,
  ): Promise<{ found: false } | { found: true; result: T }> {
    const row = await this.prisma.idempotencyCommand.findUnique({
      where: {
        callerService_key: { callerService: meta.callerService, key: meta.idempotencyKey },
      },
    });
    if (!row) return { found: false };
    if (row.requestHash.trim() !== requestHash)
      throw new ConflictException('Idempotency-Key was already used for another command.');
    const stored = row.response as unknown as StoredResponse<T>;
    if (!stored || typeof stored !== 'object' || !('result' in stored))
      throw new ServiceUnavailableException('Stored idempotency result is invalid.');
    return { found: true, result: stored.result };
  }

  private replayHealthObservation(
    row: {
      id: string;
      externalObservationId: string;
      requestHash: string;
      observedAt: Date;
      appliedAsLatest: boolean;
    },
    requestHash: string,
    deviceId: string,
  ): HealthObservationResult {
    if (row.requestHash.trim() !== requestHash)
      throw new ConflictException('Observation ID was already used for another health report.');
    return {
      accepted: true,
      duplicate: true,
      deviceId,
      observationId: row.id,
      observedAt: row.observedAt.toISOString(),
      isLatest: row.appliedAsLatest,
    };
  }

  private replayTransactionImport(
    row: { externalEventId: string; transactionId: string; requestHash: string },
    requestHash: string,
  ): TransactionImportResult {
    if (row.requestHash.trim() !== requestHash)
      throw new ConflictException('Event ID was already used for another transaction.');
    return {
      accepted: true,
      duplicate: true,
      externalEventId: row.externalEventId,
      transactionId: row.transactionId,
    };
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    device: PrismaDevice,
    meta: DeviceCommandMeta,
    action: string,
    before: object | null,
    after: object,
    reason: string | null,
  ): Promise<void> {
    await tx.deviceAuditLog.create({
      data: {
        id: randomUUID(),
        actorUserId: meta.actorUserId,
        callerService: meta.callerService,
        action,
        deviceId: device.id,
        organizationId: device.organizationId,
        branchId: device.branchId,
        correlationId: meta.correlationId,
        reason,
        before: before === null ? Prisma.DbNull : (before as Prisma.InputJsonValue),
        after: after as Prisma.InputJsonValue,
      },
    });
  }

  private async writeOutbox(
    tx: Prisma.TransactionClient,
    envelope: ReturnType<typeof createEventEnvelope>,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: envelope.eventId,
        eventType: envelope.eventType,
        aggregateId: envelope.aggregateId,
        envelope: envelope as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

function mapRecord(row: PrismaDevice): DeviceRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    adapterKey: row.adapterKey,
    externalDeviceId: row.externalDeviceId,
    displayName: row.displayName,
    deviceType: row.deviceType,
    status: row.status,
    latestReportedState: row.latestReportedState,
    latestObservedAt: row.latestObservedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEdgeInstallation(row: PrismaEdgeInstallation): EdgeInstallationRecord {
  return {
    sourceInstanceId: row.sourceInstanceId,
    organizationId: row.organizationId,
    branchId: row.branchId,
    currentKeyId: row.currentKeyId,
    previousKeyId: row.previousKeyId,
    status: row.status,
    version: row.version,
    lastHeartbeatAt: row.lastHeartbeatAt,
  };
}

function auditSnapshot(device: PrismaDevice) {
  return {
    deviceId: device.id,
    organizationId: device.organizationId,
    branchId: device.branchId,
    adapterKey: device.adapterKey,
    displayName: device.displayName,
    deviceType: device.deviceType,
    status: device.status,
    version: device.version,
  };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
