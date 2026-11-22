import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/prisma/index.js';
import type {
  EdgeOperatorPairingRecord,
  EdgeOperatorPairingRepository,
} from '../../../application/ports/edge-operator-pairing.repository.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaEdgeOperatorPairingRepository implements EdgeOperatorPairingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPending(input: {
    id: string;
    sourceInstanceId: string;
    organizationId: string;
    branchId: string;
    pairingCodeHash: string;
    pollSecretHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const retentionCutoff = new Date(Date.now() - 24 * 60 * 60_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.edgeOperatorPairing.updateMany({
        where: {
          sourceInstanceId: input.sourceInstanceId,
          status: { in: ['pending', 'approved'] },
        },
        data: { status: 'cancelled' },
      });
      await tx.edgeOperatorPairing.deleteMany({ where: { expiresAt: { lt: retentionCutoff } } });
      await tx.edgeOperatorPairing.create({ data: input });
    });
  }

  async findById(id: string) {
    const row = await this.prisma.edgeOperatorPairing.findUnique({ where: { id } });
    return row ? mapPairing(row) : null;
  }

  async findByApprovalIdempotencyKey(key: string) {
    const row = await this.prisma.edgeOperatorPairing.findUnique({
      where: { approvalIdempotencyKey: key },
    });
    return row ? mapPairing(row) : null;
  }

  async consumeApprovalRateLimit(input: {
    actorUserId: string;
    windowStartedAt: Date;
    limit: number;
  }) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ attempt_count: number }>>(
      'INSERT INTO "device_integration"."edge_operator_pairing_rate_limits" ' +
        '("actor_user_id", "window_started_at", "attempt_count", "updated_at") ' +
        'VALUES ($1::uuid, $2::timestamptz, 1, CURRENT_TIMESTAMP) ' +
        'ON CONFLICT ("actor_user_id", "window_started_at") ' +
        'DO UPDATE SET "attempt_count" = "edge_operator_pairing_rate_limits"."attempt_count" + 1, ' +
        '"updated_at" = CURRENT_TIMESTAMP ' +
        'WHERE "edge_operator_pairing_rate_limits"."attempt_count" < $3 ' +
        'RETURNING "attempt_count"',
      input.actorUserId,
      input.windowStartedAt,
      input.limit,
    );
    return rows.length === 1;
  }

  async approve(input: {
    pairingCodeHash: string;
    organizationId: string;
    branchId: string;
    actorUserId: string;
    managementSessionId: string;
    permissionKeys: string[];
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    now: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.edgeOperatorPairing.findFirst({
        where: {
          pairingCodeHash: input.pairingCodeHash,
          status: 'pending',
          expiresAt: { gt: input.now },
          organizationId: input.organizationId,
          branchId: input.branchId,
        },
      });
      if (!current) return null;
      const installation = await tx.edgeInstallation.findUnique({
        where: { sourceInstanceId: current.sourceInstanceId },
      });
      if (
        !installation ||
        installation.status !== 'active' ||
        installation.organizationId !== input.organizationId ||
        installation.branchId !== input.branchId
      )
        return null;
      const changed = await tx.edgeOperatorPairing.updateMany({
        where: { id: current.id, status: 'pending', expiresAt: { gt: input.now } },
        data: {
          status: 'approved',
          actorUserId: input.actorUserId,
          managementSessionId: input.managementSessionId,
          permissionKeys: input.permissionKeys as Prisma.InputJsonValue,
          approvalIdempotencyKey: input.idempotencyKey,
          approvalRequestHash: input.requestHash,
          approvedAt: input.now,
        },
      });
      if (changed.count !== 1) return null;
      const row = await tx.edgeOperatorPairing.findUniqueOrThrow({ where: { id: current.id } });
      await tx.edgeInstallationAudit.create({
        data: {
          id: randomUUID(),
          sourceInstanceId: row.sourceInstanceId,
          organizationId: row.organizationId,
          branchId: row.branchId,
          actorUserId: input.actorUserId,
          callerService: 'api-gateway',
          action: 'operator.pairing.approved',
          correlationId: input.correlationId,
          after: {
            pairingId: row.id,
            status: 'approved',
            permissionKeys: input.permissionKeys,
            expiresAt: row.expiresAt.toISOString(),
            managementSessionId: input.managementSessionId,
          },
        },
      });
      return mapPairing(row);
    });
  }

  async claim(input: { id: string; sourceInstanceId: string; now: Date }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.edgeOperatorPairing.findFirst({
        where: {
          id: input.id,
          sourceInstanceId: input.sourceInstanceId,
          status: 'approved',
          expiresAt: { gt: input.now },
        },
      });
      if (!current) return null;
      const installation = await tx.edgeInstallation.findUnique({
        where: { sourceInstanceId: input.sourceInstanceId },
      });
      if (
        !installation ||
        installation.status !== 'active' ||
        installation.branchId !== current.branchId ||
        installation.organizationId !== current.organizationId
      )
        return null;
      const updated = await tx.edgeOperatorPairing.updateMany({
        where: {
          id: input.id,
          sourceInstanceId: input.sourceInstanceId,
          status: 'approved',
          expiresAt: { gt: input.now },
        },
        data: { status: 'claimed', claimedAt: input.now },
      });
      if (updated.count !== 1) return null;
      return mapPairing(
        await tx.edgeOperatorPairing.findUniqueOrThrow({ where: { id: input.id } }),
      );
    });
  }

  async markIssued(input: { id: string; tokenId: string; expiresAt: Date; correlationId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.edgeOperatorPairing.findUnique({ where: { id: input.id } });
      if (!current || current.status !== 'claimed' || !current.actorUserId) return false;
      const updated = await tx.edgeOperatorPairing.updateMany({
        where: { id: input.id, status: 'claimed' },
        data: { status: 'issued', issuedAt: new Date() },
      });
      if (updated.count !== 1) return false;
      await tx.edgeInstallationAudit.create({
        data: {
          id: randomUUID(),
          sourceInstanceId: current.sourceInstanceId,
          organizationId: current.organizationId,
          branchId: current.branchId,
          actorUserId: current.actorUserId,
          callerService: 'device-integration',
          action: 'operator.pairing.issued',
          correlationId: input.correlationId,
          after: {
            pairingId: current.id,
            tokenId: input.tokenId,
            permissionKeys: current.permissionKeys,
            expiresAt: input.expiresAt.toISOString(),
          },
        },
      });
      return true;
    });
  }

  async markFailed(id: string) {
    await this.prisma.edgeOperatorPairing.updateMany({
      where: { id, status: 'claimed' },
      data: { status: 'failed' },
    });
  }

  async markExpired(id: string) {
    await this.prisma.edgeOperatorPairing.updateMany({
      where: { id, status: { in: ['pending', 'approved'] }, expiresAt: { lte: new Date() } },
      data: { status: 'expired' },
    });
  }

  async cancel(input: { id: string; sourceInstanceId: string }) {
    const result = await this.prisma.edgeOperatorPairing.updateMany({
      where: {
        id: input.id,
        sourceInstanceId: input.sourceInstanceId,
        status: { in: ['pending', 'approved'] },
      },
      data: { status: 'cancelled' },
    });
    return result.count === 1;
  }
}

function mapPairing(row: {
  id: string;
  sourceInstanceId: string;
  organizationId: string;
  branchId: string;
  pairingCodeHash: string;
  pollSecretHash: string;
  status: string;
  expiresAt: Date;
  actorUserId: string | null;
  managementSessionId: string | null;
  permissionKeys: Prisma.JsonValue | null;
  approvalIdempotencyKey: string | null;
  approvalRequestHash: string | null;
}): EdgeOperatorPairingRecord {
  const permissionKeys =
    Array.isArray(row.permissionKeys) &&
    row.permissionKeys.every((item): item is string => typeof item === 'string')
      ? row.permissionKeys
      : null;
  const status = [
    'pending',
    'approved',
    'claimed',
    'issued',
    'failed',
    'cancelled',
    'expired',
  ].includes(row.status)
    ? (row.status as EdgeOperatorPairingRecord['status'])
    : 'failed';
  return {
    id: row.id,
    sourceInstanceId: row.sourceInstanceId,
    organizationId: row.organizationId,
    branchId: row.branchId,
    pairingCodeHash: row.pairingCodeHash,
    pollSecretHash: row.pollSecretHash,
    status,
    expiresAt: row.expiresAt,
    actorUserId: row.actorUserId,
    managementSessionId: row.managementSessionId,
    permissionKeys,
    approvalIdempotencyKey: row.approvalIdempotencyKey,
    approvalRequestHash: row.approvalRequestHash,
  };
}
