import { createHash, randomUUID } from 'node:crypto';
import {
  GoneException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/index.js';
import { DeviceRegistryService } from './device-registry.service.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';
import { WalletEdgeMappingClient } from '../infrastructure/wallet/wallet-edge-mapping.client.js';
import { PricingSnapshotClient } from '../infrastructure/pricing/pricing-snapshot.client.js';
import {
  DEVICE_SIGNATURE_VERIFIER,
  type DeviceSignatureVerifier,
} from './ports/device-signature-verifier.port.js';

type SnapshotRecord = {
  kind: 'device' | 'card_mapping' | 'attraction' | 'setting';
  value: Record<string, unknown>;
};

type SnapshotDocument = {
  snapshotId: string;
  snapshotVersion: string;
  branchId: string;
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
    @Inject(DEVICE_SIGNATURE_VERIFIER) private readonly signatureVerifier: DeviceSignatureVerifier,
  ) {}

  async getPage(input: {
    sourceInstanceId: string;
    branchId: string;
    keyId: string;
    cursor?: string;
  }) {
    const keyId = input.keyId;
    if (!this.signatureVerifier.isEdgeConfigured() || !keyId || keyId.length > 120)
      throw new ServiceUnavailableException('Edge snapshot signing is not configured.');

    const installation = await this.devices.getEdgeInstallation(input.sourceInstanceId);
    if (
      !installation ||
      installation.status !== 'active' ||
      installation.branchId !== input.branchId
    )
      throw new UnauthorizedException('Edge installation is not authorized for this branch.');
    const heartbeatAt = new Date();
    await this.prisma.edgeInstallation.updateMany({
      where: {
        sourceInstanceId: input.sourceInstanceId,
        status: 'active',
        branchId: input.branchId,
      },
      data: { lastHeartbeatAt: heartbeatAt, updatedAt: heartbeatAt },
    });

    const snapshot = input.cursor
      ? await this.loadCursorSnapshot(input.cursor, input.sourceInstanceId, input.branchId, keyId)
      : await this.createSnapshot(installation);
    if (snapshot.validUntil.getTime() <= Date.now())
      throw new GoneException('Edge snapshot has expired.');

    const cursorData = input.cursor ? this.decodeCursor(input.cursor, keyId) : { offset: 0 };
    const document = snapshot.document as unknown as SnapshotDocument;
    const items = document.records.slice(cursorData.offset, cursorData.offset + pageSize);
    const nextOffset = cursorData.offset + items.length;
    const nextCursor =
      nextOffset < document.records.length
        ? this.encodeCursor(
            {
              snapshotId: snapshot.id,
              sourceInstanceId: input.sourceInstanceId,
              branchId: input.branchId,
              keyId,
              offset: nextOffset,
            },
            keyId,
          )
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
    const signed = { ...page, signingKeyId: keyId };
    const signature = this.signatureVerifier.signEdge(
      Buffer.from(stableStringify(signed), 'utf8'),
      keyId,
    );
    if (!signature)
      throw new ServiceUnavailableException('Edge snapshot signing key is not configured.');
    return { ...signed, signature };
  }

  private async createSnapshot(installation: {
    sourceInstanceId: string;
    organizationId: string;
    branchId: string;
  }) {
    const generatedAt = new Date();
    const validUntil = new Date(generatedAt.getTime() + validityMilliseconds);
    const [devices, cardMappings, pricing] = await Promise.all([
      this.listAllActiveDevices(installation.organizationId, installation.branchId),
      this.walletMappings.listMappings(installation.organizationId, installation.branchId),
      this.pricing.getBranchSnapshot(installation.branchId),
    ]);
    const records: SnapshotRecord[] = [
      ...devices.map((device) => ({
        kind: 'device' as const,
        value: {
          deviceId: device.id,
          displayName: device.displayName,
          deviceType: device.deviceType,
          version: device.version,
        },
      })),
      ...cardMappings.map((mapping) => ({
        kind: 'card_mapping' as const,
        value: {
          cardId: mapping.cardId,
          cardUidHash: mapping.cardUidHash,
          householdId: mapping.householdId,
          memberId: mapping.memberId,
        },
      })),
    ];
    const id = randomUUID();
    const version = `edge-v2-${randomUUID()}`;
    const document: SnapshotDocument = {
      snapshotId: id,
      snapshotVersion: version,
      branchId: installation.branchId,
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
    const documentHash = createHash('sha256')
      .update(stableStringify(snapshotHashMaterial(document)))
      .digest('hex');
    return this.prisma.edgeSnapshot.create({
      data: {
        id,
        sourceInstanceId: installation.sourceInstanceId,
        organizationId: installation.organizationId,
        branchId: installation.branchId,
        version,
        document: document as unknown as Prisma.InputJsonValue,
        documentHash,
        validFrom: generatedAt,
        validUntil,
      },
    });
  }

  private async listAllActiveDevices(organizationId: string, branchId: string) {
    const rows: Array<{ id: string; displayName: string; deviceType: string; version: number }> =
      [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 200; page += 1) {
      const result = await this.devices.listDevices({
        organizationId,
        branchId,
        status: 'active',
        pageSize: 100,
        cursor,
      });
      for (const device of result.items) {
        if (
          device.organizationId !== organizationId ||
          device.branchId !== branchId ||
          seen.has(device.id)
        )
          throw new ServiceUnavailableException('Device snapshot scope is inconsistent.');
        seen.add(device.id);
        rows.push({
          id: device.id,
          displayName: device.displayName,
          deviceType: device.deviceType,
          version: device.version,
        });
      }
      if (!result.nextCursor) return rows;
      if (result.nextCursor === cursor || result.items.at(-1)?.id !== result.nextCursor)
        throw new ServiceUnavailableException('Device snapshot cursor is invalid.');
      cursor = result.nextCursor;
    }
    throw new ServiceUnavailableException('Device snapshot exceeds the supported size.');
  }

  private async loadCursorSnapshot(
    cursor: string,
    sourceInstanceId: string,
    branchId: string,
    keyId: string,
  ) {
    const decoded = this.decodeCursor(cursor, keyId);
    const snapshot = await this.prisma.edgeSnapshot.findUnique({
      where: { id: decoded.snapshotId },
    });
    if (
      !snapshot ||
      snapshot.sourceInstanceId !== sourceInstanceId ||
      snapshot.branchId !== branchId ||
      decoded.sourceInstanceId !== sourceInstanceId ||
      decoded.branchId !== branchId
    )
      throw new UnauthorizedException('Snapshot cursor is not valid for this installation.');
    return snapshot;
  }

  private encodeCursor(
    value: {
      snapshotId: string;
      sourceInstanceId: string;
      branchId: string;
      keyId: string;
      offset: number;
    },
    keyId: string,
  ) {
    const payload = Buffer.from(stableStringify(value)).toString('base64url');
    const signature = this.signatureVerifier.signEdge(Buffer.from(payload, 'utf8'), keyId);
    if (!signature)
      throw new ServiceUnavailableException('Edge snapshot signing key is not configured.');
    return `${payload}.${signature.slice('sha256='.length)}`;
  }

  private decodeCursor(value: string, keyId: string) {
    const [payload, signature, ...rest] = value.split('.');
    if (!payload || !signature || rest.length || !/^[a-f0-9]{64}$/iu.test(signature))
      throw new UnauthorizedException('Snapshot cursor is invalid.');
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      if (
        typeof decoded.snapshotId !== 'string' ||
        typeof decoded.sourceInstanceId !== 'string' ||
        typeof decoded.branchId !== 'string' ||
        decoded.keyId !== keyId ||
        !Number.isSafeInteger(decoded.offset) ||
        Number(decoded.offset) < 0
      )
        throw new Error('invalid');
      if (
        !this.signatureVerifier.verifyEdge(
          Buffer.from(payload, 'utf8'),
          keyId,
          `sha256=${signature}`,
        )
      )
        throw new Error('invalid');
      return decoded as {
        snapshotId: string;
        sourceInstanceId: string;
        branchId: string;
        keyId: string;
        offset: number;
      };
    } catch {
      throw new UnauthorizedException('Snapshot cursor is invalid.');
    }
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function snapshotHashMaterial(document: SnapshotDocument) {
  return {
    snapshotId: document.snapshotId,
    snapshotVersion: document.snapshotVersion,
    branchId: document.branchId,
    generatedAt: document.generatedAt,
    validFrom: document.validFrom,
    validUntil: document.validUntil,
    pricing: document.pricing,
    attractions: document.attractions,
    settings: document.settings,
    items: document.records,
  };
}
