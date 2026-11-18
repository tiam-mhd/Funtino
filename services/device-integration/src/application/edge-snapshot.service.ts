import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { GoneException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/index.js';
import { DeviceRegistryService } from './device-registry.service.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';
import { WalletEdgeMappingClient } from '../infrastructure/wallet/wallet-edge-mapping.client.js';
import { PricingSnapshotClient } from '../infrastructure/pricing/pricing-snapshot.client.js';

type SnapshotRecord = {
  kind: 'device' | 'card_mapping' | 'attraction' | 'setting';
  value: Record<string, unknown>;
};

type SnapshotDocument = {
  formatVersion: 2;
  organizationId: string;
  branchId: string;
  sourceInstanceId: string;
  generatedAt: string;
  validFrom: string;
  validUntil: string;
  pricing: {
    status: 'disabled';
    version: null;
    reasonCode: 'PENDING_WINDOWS_GOLDEN_VECTORS';
    rules: [];
  };
  attractions: [];
  settings: [];
  records: SnapshotRecord[];
};

const pageSize = 100;
const validityMilliseconds = 60 * 60 * 1000;

@Injectable()
export class EdgeSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DeviceRegistryService,
    private readonly walletMappings: WalletEdgeMappingClient,
    private readonly pricing: PricingSnapshotClient,
  ) {}

  async getPage(input: { sourceInstanceId: string; branchId: string; cursor?: string }) {
    const secret = process.env.DEVICE_EDGE_SNAPSHOT_SIGNING_SECRET;
    const keyId = process.env.DEVICE_EDGE_SNAPSHOT_SIGNING_KEY_ID;
    if (!secret || secret.length < 32 || secret.length > 512 || !keyId || keyId.length > 120)
      throw new ServiceUnavailableException('Edge snapshot signing is not configured.');

    const installation = await this.devices.getEdgeInstallation(input.sourceInstanceId);
    if (!installation || installation.status !== 'active' || installation.branchId !== input.branchId)
      throw new UnauthorizedException('Edge installation is not authorized for this branch.');
    const heartbeatAt = new Date();
    await this.prisma.edgeInstallation.updateMany({
      where: { sourceInstanceId: input.sourceInstanceId, status: 'active', branchId: input.branchId },
      data: { lastHeartbeatAt: heartbeatAt, updatedAt: heartbeatAt },
    });

    const snapshot = input.cursor
      ? await this.loadCursorSnapshot(input.cursor, input.sourceInstanceId, input.branchId, secret)
      : await this.createSnapshot(installation);
    if (snapshot.validUntil.getTime() <= Date.now()) throw new GoneException('Edge snapshot has expired.');

    const cursorData = input.cursor
      ? this.decodeCursor(input.cursor, secret)
      : { offset: 0 };
    const document = snapshot.document as unknown as SnapshotDocument;
    const items = document.records.slice(cursorData.offset, cursorData.offset + pageSize);
    const nextOffset = cursorData.offset + items.length;
    const nextCursor = nextOffset < document.records.length
      ? this.encodeCursor({ snapshotId: snapshot.id, sourceInstanceId: input.sourceInstanceId, branchId: input.branchId, offset: nextOffset }, secret)
      : null;
    const page = {
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      branchId: snapshot.branchId,
      generatedAt: snapshot.createdAt.toISOString(),
      validFrom: snapshot.validFrom.toISOString(),
      validUntil: snapshot.validUntil.toISOString(),
      documentHash: snapshot.documentHash,
      pricing: document.pricing,
      attractions: document.attractions,
      settings: document.settings,
      items,
      nextCursor,
    };
    return { ...page, signature: sign(page, secret), signingKeyId: keyId };
  }

  private async createSnapshot(installation: {
    sourceInstanceId: string; organizationId: string; branchId: string;
  }) {
    const generatedAt = new Date();
    const validUntil = new Date(generatedAt.getTime() + validityMilliseconds);
    const [devices, cardMappings, pricing] = await Promise.all([
      this.listAllActiveDevices(installation.organizationId, installation.branchId),
      this.walletMappings.listMappings(installation.organizationId, installation.branchId),
      this.pricing.getBranchSnapshot(installation.branchId),
    ]);
    const records: SnapshotRecord[] = [
      ...devices.map((device) => ({ kind: 'device' as const, value: {
        deviceId: device.id,
        displayName: device.displayName,
        deviceType: device.deviceType,
        version: device.version,
      } })),
      ...cardMappings.map((mapping) => ({ kind: 'card_mapping' as const, value: {
        cardId: mapping.cardId,
        physicalCardIdentifier: mapping.externalCardId,
        householdId: mapping.householdId,
        memberId: mapping.memberId,
      } })),
    ];
    const document: SnapshotDocument = {
      formatVersion: 2,
      organizationId: installation.organizationId,
      branchId: installation.branchId,
      sourceInstanceId: installation.sourceInstanceId,
      generatedAt: generatedAt.toISOString(),
      validFrom: generatedAt.toISOString(),
      validUntil: validUntil.toISOString(),
      pricing: {
        status: pricing.status,
        version: pricing.version,
        reasonCode: pricing.reasonCode,
        rules: [],
      },
      attractions: [],
      settings: [],
      records,
    };
    const documentHash = createHash('sha256').update(stableStringify(document)).digest('hex');
    return this.prisma.edgeSnapshot.create({
      data: {
        id: randomUUID(),
        sourceInstanceId: installation.sourceInstanceId,
        organizationId: installation.organizationId,
        branchId: installation.branchId,
        version: `edge-v2-${randomUUID()}`,
        document: document as unknown as Prisma.InputJsonValue,
        documentHash,
        validFrom: generatedAt,
        validUntil,
      },
    });
  }

  private async listAllActiveDevices(organizationId: string, branchId: string) {
    const rows: Array<{ id: string; displayName: string; deviceType: string; version: number }> = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 200; page += 1) {
      const result = await this.devices.listDevices({ organizationId, branchId, status: 'active', pageSize: 100, cursor });
      for (const device of result.items) {
        if (device.organizationId !== organizationId || device.branchId !== branchId || seen.has(device.id))
          throw new ServiceUnavailableException('Device snapshot scope is inconsistent.');
        seen.add(device.id);
        rows.push({ id: device.id, displayName: device.displayName, deviceType: device.deviceType, version: device.version });
      }
      if (!result.nextCursor) return rows;
      if (result.nextCursor === cursor || result.items.at(-1)?.id !== result.nextCursor)
        throw new ServiceUnavailableException('Device snapshot cursor is invalid.');
      cursor = result.nextCursor;
    }
    throw new ServiceUnavailableException('Device snapshot exceeds the supported size.');
  }

  private async loadCursorSnapshot(cursor: string, sourceInstanceId: string, branchId: string, secret: string) {
    const decoded = this.decodeCursor(cursor, secret);
    const snapshot = await this.prisma.edgeSnapshot.findUnique({ where: { id: decoded.snapshotId } });
    if (!snapshot || snapshot.sourceInstanceId !== sourceInstanceId || snapshot.branchId !== branchId ||
      decoded.sourceInstanceId !== sourceInstanceId || decoded.branchId !== branchId)
      throw new UnauthorizedException('Snapshot cursor is not valid for this installation.');
    return snapshot;
  }

  private encodeCursor(value: { snapshotId: string; sourceInstanceId: string; branchId: string; offset: number }, secret: string) {
    const payload = Buffer.from(stableStringify(value)).toString('base64url');
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`;
  }

  private decodeCursor(value: string, secret: string) {
    const [payload, signature, ...rest] = value.split('.');
    if (!payload || !signature || rest.length || !/^[a-f0-9]{64}$/iu.test(signature))
      throw new UnauthorizedException('Snapshot cursor is invalid.');
    const expected = createHmac('sha256', secret).update(payload).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw new UnauthorizedException('Snapshot cursor is invalid.');
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (typeof decoded.snapshotId !== 'string' || typeof decoded.sourceInstanceId !== 'string' ||
        typeof decoded.branchId !== 'string' || !Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 0)
        throw new Error('invalid');
      return decoded as { snapshotId: string; sourceInstanceId: string; branchId: string; offset: number };
    } catch {
      throw new UnauthorizedException('Snapshot cursor is invalid.');
    }
  }
}

function sign(value: unknown, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
