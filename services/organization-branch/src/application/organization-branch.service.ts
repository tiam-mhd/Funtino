import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import { Prisma, ResourceStatus } from '../../generated/prisma/index.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

const statuses = ['active', 'suspended', 'archived'] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'A valid IANA timezone is required.');
const openingHoursSchema = z.record(
  z.enum(['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  z.object({ open: time, close: time }).strict().nullable(),
);

export const organizationInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    timezone,
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict();

export const organizationUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    timezone: timezone.optional(),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.slug !== undefined || value.timezone !== undefined,
  );

export const branchInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    address: z.string().trim().min(3).max(500),
    city: z.string().trim().min(2).max(120),
    timezone,
    openingHours: openingHoursSchema,
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict();

export const branchUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    address: z.string().trim().min(3).max(500).optional(),
    city: z.string().trim().min(2).max(120).optional(),
    timezone: timezone.optional(),
    openingHours: openingHoursSchema.optional(),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.slug !== undefined ||
      value.address !== undefined ||
      value.city !== undefined ||
      value.timezone !== undefined ||
      value.openingHours !== undefined,
  );

export const statusInputSchema = z
  .object({
    status: z.enum(statuses),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'archived' && (!value.reason || value.reason.length < 8)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Archiving an organization or branch requires a reason.',
      });
    }
  });

export type CommandMeta = {
  callerService: 'api-gateway' | 'identity-access';
  idempotencyKey: string;
  actorUserId: string;
  correlationId: string;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: ResourceStatus;
  version: number;
  legacyCreatedAtLocal: string | null;
  legacyUpdatedAtLocal: string | null;
  createdAt: Date;
  updatedAt: Date;
};
type BranchRow = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  timezone: string;
  status: ResourceStatus;
  openingHours: Prisma.JsonValue;
  version: number;
  legacyCreatedAtLocal: string | null;
  legacyUpdatedAtLocal: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function json(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapOrganization(row: OrganizationRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    status: row.status,
    version: row.version,
    legacyCreatedAtLocal: row.legacyCreatedAtLocal ?? null,
    legacyUpdatedAtLocal: row.legacyUpdatedAtLocal ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapBranch(row: BranchRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    address: row.address,
    city: row.city,
    timezone: row.timezone,
    status: row.status,
    openingHours: openingHoursSchema.parse(row.openingHours),
    version: row.version,
    legacyCreatedAtLocal: row.legacyCreatedAtLocal ?? null,
    legacyUpdatedAtLocal: row.legacyUpdatedAtLocal ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

@Injectable()
export class OrganizationBranchService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrganizations(page: { cursor?: string; pageSize: number }) {
    const rows = await this.prisma.organization.findMany({
      where: page.cursor ? { id: { gt: page.cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: page.pageSize + 1,
    });
    const hasMore = rows.length > page.pageSize;
    const items = rows.slice(0, page.pageSize).map((row) => mapOrganization(row));
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  }

  async getOrganization(id: string) {
    const row = await this.prisma.organization.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Organization not found.');
    return mapOrganization(row);
  }

  async createOrganization(input: z.infer<typeof organizationInputSchema>, meta: CommandMeta) {
    const { reason, ...data } = input;
    return this.idempotent(meta, 'POST:/internal/v1/organizations', input, async (tx) => {
      const row = await tx.organization.create({ data });
      const result = mapOrganization(row);
      const payload = this.organizationSnapshot(result);
      const event = createEventEnvelope({
        eventType: eventTypes.organizationCreated,
        sourceId: 'organization-branch',
        aggregateId: row.id,
        correlationId: meta.correlationId,
        organizationId: row.id,
        payload,
      });
      await this.writeMutation(
        tx,
        meta,
        reason,
        'organization.created',
        'organization',
        row.id,
        row.id,
        null,
        null,
        result,
        event,
      );
      return result;
    });
  }

  async updateOrganization(
    id: string,
    expectedVersion: number,
    input: z.infer<typeof organizationUpdateSchema>,
    meta: CommandMeta,
  ) {
    const { reason, ...changes } = input;
    return this.idempotent(
      meta,
      `PATCH:/internal/v1/organizations/${id}`,
      { ...input, expectedVersion },
      async (tx) => {
        const before = await tx.organization.findUnique({ where: { id } });
        if (!before) throw new NotFoundException('Organization not found.');
        this.assertVersion(before.version, expectedVersion);
        this.assertNotArchived(before.status);
        const changed = await tx.organization.updateMany({
          where: { id, version: expectedVersion },
          data: { ...changes, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException('Resource version is stale. Reload and retry.');
        const updated = await tx.organization.findUniqueOrThrow({ where: { id } });
        const result = mapOrganization(updated);
        const event = createEventEnvelope({
          eventType: eventTypes.organizationUpdated,
          sourceId: 'organization-branch',
          aggregateId: id,
          correlationId: meta.correlationId,
          organizationId: id,
          payload: this.organizationSnapshot(result),
        });
        await this.writeMutation(
          tx,
          meta,
          reason,
          'organization.updated',
          'organization',
          id,
          id,
          null,
          mapOrganization(before),
          result,
          event,
        );
        return result;
      },
    );
  }

  async changeOrganizationStatus(
    id: string,
    expectedVersion: number,
    input: z.infer<typeof statusInputSchema>,
    meta: CommandMeta,
  ) {
    return this.idempotent(
      meta,
      `POST:/internal/v1/organizations/${id}/status`,
      { ...input, expectedVersion },
      async (tx) => {
        const before = await tx.organization.findUnique({ where: { id } });
        if (!before) throw new NotFoundException('Organization not found.');
        this.assertVersion(before.version, expectedVersion);
        this.assertStatusTransition(before.status, input.status);
        if (before.status === input.status) return mapOrganization(before);
        const changed = await tx.organization.updateMany({
          where: { id, version: expectedVersion },
          data: { status: input.status, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException('Resource version is stale. Reload and retry.');
        const updated = await tx.organization.findUniqueOrThrow({ where: { id } });
        const result = mapOrganization(updated);
        const event = createEventEnvelope({
          eventType: eventTypes.organizationStatusChanged,
          sourceId: 'organization-branch',
          aggregateId: id,
          correlationId: meta.correlationId,
          organizationId: id,
          payload: {
            organizationId: id,
            previousStatus: before.status,
            status: updated.status,
            version: updated.version,
          },
        });
        await this.writeMutation(
          tx,
          meta,
          input.reason,
          'organization.status_changed',
          'organization',
          id,
          id,
          null,
          mapOrganization(before),
          result,
          event,
        );
        return result;
      },
    );
  }

  async listBranches(page: { organizationId?: string; cursor?: string; pageSize: number }) {
    if (page.organizationId) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: page.organizationId },
        select: { id: true },
      });
      if (!organization) throw new NotFoundException('Organization not found.');
    }
    const rows = await this.prisma.branch.findMany({
      where: {
        ...(page.organizationId ? { organizationId: page.organizationId } : {}),
        ...(page.cursor ? { id: { gt: page.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: page.pageSize + 1,
    });
    const hasMore = rows.length > page.pageSize;
    const items = rows.slice(0, page.pageSize).map((row) => mapBranch(row));
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  }

  async getBranch(organizationId: string, id: string) {
    const row = await this.prisma.branch.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Branch not found.');
    return mapBranch(row);
  }

  async listPublicBranches(page: { cursor?: string; pageSize: number }) {
    const rows = await this.prisma.branch.findMany({
      where: {
        status: 'active',
        organization: { status: 'active' },
        ...(page.cursor ? { id: { gt: page.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: page.pageSize + 1,
    });
    const hasMore = rows.length > page.pageSize;
    const items = rows.slice(0, page.pageSize).map((row) => mapBranch(row));
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  }

  async getPublicBranch(id: string) {
    const row = await this.prisma.branch.findFirst({
      where: { id, status: 'active', organization: { status: 'active' } },
    });
    if (!row) throw new NotFoundException('Active branch not found.');
    return mapBranch(row);
  }

  async createBranch(
    organizationId: string,
    input: z.infer<typeof branchInputSchema>,
    meta: CommandMeta,
  ) {
    const { reason, ...data } = input;
    return this.idempotent(
      meta,
      `POST:/internal/v1/organizations/${organizationId}/branches`,
      input,
      async (tx) => {
        const organization = await tx.organization.findUnique({ where: { id: organizationId } });
        if (!organization) throw new NotFoundException('Organization not found.');
        if (organization.status !== 'active')
          throw new ConflictException('Branches can only be added to an active organization.');
        const row = await tx.branch.create({
          data: {
            ...data,
            organizationId,
            openingHours: data.openingHours as Prisma.InputJsonValue,
          },
        });
        const result = mapBranch(row);
        const event = createEventEnvelope({
          eventType: eventTypes.branchCreated,
          sourceId: 'organization-branch',
          aggregateId: row.id,
          correlationId: meta.correlationId,
          organizationId,
          branchId: row.id,
          payload: this.branchSnapshot(result),
        });
        await this.writeMutation(
          tx,
          meta,
          reason,
          'branch.created',
          'branch',
          row.id,
          organizationId,
          row.id,
          null,
          result,
          event,
        );
        return result;
      },
    );
  }

  async updateBranch(
    organizationId: string,
    id: string,
    expectedVersion: number,
    input: z.infer<typeof branchUpdateSchema>,
    meta: CommandMeta,
  ) {
    const { reason, ...changes } = input;
    return this.idempotent(
      meta,
      `PATCH:/internal/v1/organizations/${organizationId}/branches/${id}`,
      { ...input, expectedVersion },
      async (tx) => {
        const before = await tx.branch.findFirst({ where: { id, organizationId } });
        if (!before) throw new NotFoundException('Branch not found.');
        this.assertVersion(before.version, expectedVersion);
        this.assertNotArchived(before.status);
        const changed = await tx.branch.updateMany({
          where: { id, organizationId, version: expectedVersion },
          data: {
            ...changes,
            ...(changes.openingHours
              ? { openingHours: changes.openingHours as Prisma.InputJsonValue }
              : {}),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ConflictException('Resource version is stale. Reload and retry.');
        const updated = await tx.branch.findUniqueOrThrow({ where: { id } });
        const result = mapBranch(updated);
        const event = createEventEnvelope({
          eventType: eventTypes.branchUpdated,
          sourceId: 'organization-branch',
          aggregateId: id,
          correlationId: meta.correlationId,
          organizationId,
          branchId: id,
          payload: this.branchSnapshot(result),
        });
        await this.writeMutation(
          tx,
          meta,
          reason,
          'branch.updated',
          'branch',
          id,
          organizationId,
          id,
          mapBranch(before),
          result,
          event,
        );
        return result;
      },
    );
  }

  async changeBranchStatus(
    organizationId: string,
    id: string,
    expectedVersion: number,
    input: z.infer<typeof statusInputSchema>,
    meta: CommandMeta,
  ) {
    return this.idempotent(
      meta,
      `POST:/internal/v1/organizations/${organizationId}/branches/${id}/status`,
      { ...input, expectedVersion },
      async (tx) => {
        const before = await tx.branch.findFirst({ where: { id, organizationId } });
        if (!before) throw new NotFoundException('Branch not found.');
        this.assertVersion(before.version, expectedVersion);
        this.assertStatusTransition(before.status, input.status);
        if (input.status === 'active') {
          const organization = await tx.organization.findUnique({ where: { id: organizationId } });
          if (!organization || organization.status !== 'active') {
            throw new ConflictException(
              'A branch cannot be activated while its organization is inactive.',
            );
          }
        }
        if (before.status === input.status) return mapBranch(before);
        const changed = await tx.branch.updateMany({
          where: { id, organizationId, version: expectedVersion },
          data: { status: input.status, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new ConflictException('Resource version is stale. Reload and retry.');
        const updated = await tx.branch.findUniqueOrThrow({ where: { id } });
        const result = mapBranch(updated);
        const event = createEventEnvelope({
          eventType: eventTypes.branchStatusChanged,
          sourceId: 'organization-branch',
          aggregateId: id,
          correlationId: meta.correlationId,
          organizationId,
          branchId: id,
          payload: {
            branchId: id,
            organizationId,
            previousStatus: before.status,
            status: updated.status,
            version: updated.version,
          },
        });
        await this.writeMutation(
          tx,
          meta,
          input.reason,
          'branch.status_changed',
          'branch',
          id,
          organizationId,
          id,
          mapBranch(before),
          result,
          event,
        );
        return result;
      },
    );
  }

  async validateScope(input: {
    type: 'organization' | 'branch';
    organizationId: string;
    branchId?: string;
  }) {
    try {
      const organization = await this.prisma.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!organization || organization.status !== 'active')
        return { valid: false, reason: 'organization_unavailable' };
      if (input.type === 'organization')
        return {
          valid: true,
          organizationId: organization.id,
          organizationVersion: organization.version,
        };
      if (!input.branchId) return { valid: false, reason: 'branch_required' };
      const branch = await this.prisma.branch.findFirst({
        where: { id: input.branchId, organizationId: organization.id, status: 'active' },
      });
      if (!branch) return { valid: false, reason: 'branch_unavailable' };
      return {
        valid: true,
        organizationId: organization.id,
        branchId: branch.id,
        organizationVersion: organization.version,
        branchVersion: branch.version,
      };
    } catch {
      throw new ServiceUnavailableException('Organization/branch scope validation is unavailable.');
    }
  }

  private async idempotent<T extends object>(
    meta: CommandMeta,
    route: string,
    command: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ route, actorUserId: meta.actorUserId, command }))
      .digest('hex');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.idempotencyCommand.findUnique({
          where: {
            callerService_key: { callerService: meta.callerService, key: meta.idempotencyKey },
          },
        });
        if (existing) return this.replay<T>(existing.requestHash, requestHash, existing.response);
        const result = await work(tx);
        await tx.idempotencyCommand.create({
          data: {
            callerService: meta.callerService,
            key: meta.idempotencyKey,
            requestHash,
            response: json({ route, result }),
          },
        });
        return result;
      });
    } catch (error) {
      if (errorCode(error) === 'P2002') {
        const existing = await this.prisma.idempotencyCommand.findUnique({
          where: {
            callerService_key: { callerService: meta.callerService, key: meta.idempotencyKey },
          },
        });
        if (existing) return this.replay<T>(existing.requestHash, requestHash, existing.response);
        throw new ConflictException('Organization or branch slug already exists.');
      }
      throw error;
    }
  }

  private replay<T>(storedHash: string, requestHash: string, response: Prisma.JsonValue): T {
    if (storedHash !== requestHash)
      throw new ConflictException('Idempotency key was already used for a different command.');
    if (
      !response ||
      typeof response !== 'object' ||
      Array.isArray(response) ||
      !('result' in response)
    ) {
      throw new ServiceUnavailableException('Stored idempotency response is invalid.');
    }
    return (response as Prisma.JsonObject).result as T;
  }

  private async writeMutation(
    tx: Prisma.TransactionClient,
    meta: CommandMeta,
    reason: string | undefined,
    action: string,
    resourceType: string,
    resourceId: string,
    organizationId: string,
    branchId: string | null,
    before: object | null,
    after: object,
    event: ReturnType<typeof createEventEnvelope>,
  ) {
    await tx.auditLog.create({
      data: {
        actorUserId: meta.actorUserId,
        callerService: meta.callerService,
        action,
        resourceType,
        resourceId,
        organizationId,
        branchId,
        correlationId: meta.correlationId,
        reason: reason?.trim() || null,
        before: before ? json(before) : Prisma.JsonNull,
        after: json(after),
      },
    });
    await tx.outboxEvent.create({
      data: {
        id: event.eventId,
        eventType: event.eventType,
        aggregateId: resourceId,
        envelope: json(event),
      },
    });
  }

  private organizationSnapshot(value: ReturnType<typeof mapOrganization>) {
    return {
      id: value.id,
      name: value.name,
      slug: value.slug,
      timezone: value.timezone,
      status: value.status,
      version: value.version,
    };
  }

  private branchSnapshot(value: ReturnType<typeof mapBranch>) {
    return {
      id: value.id,
      organizationId: value.organizationId,
      name: value.name,
      slug: value.slug,
      address: value.address,
      city: value.city,
      timezone: value.timezone,
      status: value.status,
      openingHours: value.openingHours,
      version: value.version,
    };
  }

  private assertVersion(actual: number, expected: number): void {
    if (actual !== expected)
      throw new ConflictException('Resource version is stale. Reload and retry.');
  }

  private assertNotArchived(status: ResourceStatus): void {
    if (status === 'archived') throw new ConflictException('Archived resources are immutable.');
  }

  private assertStatusTransition(current: ResourceStatus, next: ResourceStatus): void {
    if (current === 'archived' && next !== 'archived')
      throw new ConflictException('Archived resources cannot be reactivated.');
    if (!statuses.includes(next)) throw new BadRequestException('Unsupported resource status.');
  }
}
