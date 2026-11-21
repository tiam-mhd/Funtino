import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

export type CustomerProfileUpdate = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  birthDate?: string | null;
  gender?: 'female' | 'male' | 'other' | 'prefer_not_to_say' | null;
  city?: string | null;
  avatarPreset?: string | null;
};

export type CustomerProfileCommandMeta = {
  expectedVersion: number;
  idempotencyKey: string;
  correlationId: string;
  actorUserId?: string;
  callerService?: 'api-gateway' | 'device-integration';
};

const allowedAvatarPresets = new Set([
  'sun',
  'star',
  'rainbow',
  'rocket',
  'crown',
  'bear',
  'cat',
  'fox',
]);

@Injectable()
export class CustomerProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const profile = await this.prisma.customerProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return present(profile);
  }

  async getAvatar(userId: string) {
    const profile = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile?.avatarData || !profile.avatarMimeType || !profile.avatarUpdatedAt) return null;
    return {
      userId,
      mimeType: profile.avatarMimeType,
      dataBase64: Buffer.from(profile.avatarData).toString('base64'),
      updatedAt: profile.avatarUpdatedAt.toISOString(),
    };
  }

  async update(userId: string, input: CustomerProfileUpdate, meta: CustomerProfileCommandMeta) {
    if (input.avatarPreset && !allowedAvatarPresets.has(input.avatarPreset)) {
      throw new ConflictException('Avatar preset is not supported.');
    }
    return this.mutate(
      userId,
      input,
      meta,
      async (tx, current) => {
        const fields = {
          ...(input.firstName === undefined ? {} : { firstName: clean(input.firstName, 60) }),
          ...(input.lastName === undefined ? {} : { lastName: clean(input.lastName, 60) }),
          ...(input.email === undefined ? {} : { email: cleanEmail(input.email) }),
          ...(input.birthDate === undefined
            ? {}
            : { birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null }),
          ...(input.gender === undefined ? {} : { gender: input.gender }),
          ...(input.city === undefined ? {} : { city: clean(input.city, 80) }),
          ...(input.avatarPreset === undefined
            ? {}
            : { avatarPreset: clean(input.avatarPreset, 32) }),
        };
        const avatarData = input.avatarPreset
          ? { avatarData: null, avatarMimeType: null, avatarUpdatedAt: null }
          : {};
        return tx.customerProfile.update({
          where: { userId: current.userId },
          data: { ...fields, ...avatarData },
        });
      },
      'customer.profile.updated',
    );
  }

  async saveAvatar(
    userId: string,
    input: { mimeType: string; dataBase64: string },
    meta: CustomerProfileCommandMeta,
  ) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType)) {
      throw new ConflictException('Avatar media type is not supported.');
    }
    const data = Buffer.from(input.dataBase64, 'base64');
    if (
      data.length === 0 ||
      data.length > 2_000_000 ||
      data.toString('base64').replace(/=+$/u, '') !== input.dataBase64.replace(/=+$/u, '') ||
      !matchesImageSignature(data, input.mimeType)
    ) {
      throw new ConflictException('Avatar data is invalid.');
    }
    return this.mutate(
      userId,
      { mimeType: input.mimeType, dataBase64: input.dataBase64 },
      meta,
      async (tx, current) =>
        tx.customerProfile.update({
          where: { userId: current.userId },
          data: {
            avatarData: data,
            avatarMimeType: input.mimeType,
            avatarUpdatedAt: new Date(),
            avatarPreset: null,
          },
        }),
      'customer.avatar.updated',
    );
  }

  private async mutate(
    userId: string,
    command: unknown,
    meta: CustomerProfileCommandMeta,
    update: (
      tx: Prisma.TransactionClient,
      current: Awaited<ReturnType<Prisma.TransactionClient['customerProfile']['upsert']>>,
    ) => Promise<unknown>,
    action: string,
  ) {
    const callerService = meta.callerService ?? 'api-gateway';
    const actorUserId = meta.actorUserId ?? userId;
    const requestHash = createHash('sha256')
      .update(stableStringify({ userId, command, expectedVersion: meta.expectedVersion }))
      .digest('hex');
    return this.prisma
      .$transaction(
        async (tx) => {
          const existing = await tx.idempotencyCommand.findUnique({
            where: {
              callerService_key: { callerService, key: meta.idempotencyKey },
            },
          });
          if (existing) {
            if (existing.requestHash !== requestHash)
              throw new ConflictException('Idempotency key was reused.');
            return existing.response;
          }

          const current = await tx.customerProfile.upsert({
            where: { userId },
            create: { userId },
            update: {},
          });
          if (current.version !== meta.expectedVersion) {
            throw new ConflictException({
              code: 'VERSION_CONFLICT',
              currentVersion: current.version,
            });
          }
          const changed = await update(tx, current);
          const merged = changed as typeof current;
          const complete = Boolean(
            merged.firstName &&
              merged.lastName &&
              merged.birthDate &&
              merged.gender &&
              merged.city &&
              (merged.avatarPreset || merged.avatarData),
          );
          const saved = await tx.customerProfile.update({
            where: { userId },
            data: {
              version: { increment: 1 },
              profileCompletedAt: complete ? (current.profileCompletedAt ?? new Date()) : null,
            },
          });
          const response = present(saved);
          await tx.auditLog.create({
            data: {
              id: randomUUID(),
              actorUserId,
              callerService,
              action,
              resourceType: 'customer_profile',
              resourceId: userId,
              correlationId: meta.correlationId,
              before: {
                version: current.version,
                profileCompleted: Boolean(current.profileCompletedAt),
              },
              after: {
                version: saved.version,
                profileCompleted: Boolean(saved.profileCompletedAt),
                changedFields: Object.keys(command as Record<string, unknown>)
                  .filter((key) => key !== 'dataBase64')
                  .sort(),
              },
            },
          });
          await tx.idempotencyCommand.create({
            data: {
              callerService,
              key: meta.idempotencyKey,
              requestHash,
              response: response as Prisma.InputJsonValue,
            },
          });
          return response;
        },
        { isolationLevel: 'Serializable', maxWait: 2_000, timeout: 5_000 },
      )
      .catch((error: unknown) => {
        if (error instanceof ConflictException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Idempotency key was already consumed.');
        }
        throw new ServiceUnavailableException('Customer profile could not be saved.');
      });
  }
}

function clean(value: string | null, maxLength: number) {
  const normalized = value?.trim().slice(0, maxLength) || null;
  return normalized;
}

function cleanEmail(value: string | null) {
  return value?.trim().toLowerCase() || null;
}

function matchesImageSignature(data: Buffer, mimeType: string) {
  if (mimeType === 'image/jpeg')
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === 'image/png')
    return data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp')
    return (
      data.length >= 12 &&
      data.toString('ascii', 0, 4) === 'RIFF' &&
      data.toString('ascii', 8, 12) === 'WEBP'
    );
  return false;
}

function present(profile: {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  birthDate: Date | null;
  gender: string | null;
  city: string | null;
  avatarPreset: string | null;
  avatarData: Uint8Array | null;
  avatarUpdatedAt: Date | null;
  profileCompletedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    userId: profile.userId,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    birthDate: profile.birthDate?.toISOString().slice(0, 10) ?? null,
    gender: profile.gender,
    city: profile.city,
    avatarPreset: profile.avatarPreset,
    hasUploadedAvatar: Boolean(profile.avatarData),
    avatarUpdatedAt: profile.avatarUpdatedAt?.toISOString() ?? null,
    profileCompletedAt: profile.profileCompletedAt?.toISOString() ?? null,
    profileCompleted: Boolean(profile.profileCompletedAt),
    version: profile.version,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
