import { Injectable } from '@nestjs/common';
import { DomainError, isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';
import type { Branch } from '../../domain/models.js';

const hoursSchema = z.record(
  z.string(),
  z.object({ open: z.string(), close: z.string() }).strict().nullable(),
);
const ownerBranchSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    address: z.string(),
    city: z.string(),
    timezone: z.string(),
    status: z.enum(['active', 'suspended', 'archived']),
    openingHours: hoursSchema,
    version: z.number().int().min(1),
    legacyCreatedAtLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/)
      .nullable(),
    legacyUpdatedAtLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/)
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .passthrough();
const ownerOrganizationSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    status: z.enum(['active', 'suspended', 'archived']),
    version: z.number().int().min(1),
    legacyCreatedAtLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/)
      .nullable(),
    legacyUpdatedAtLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/)
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
const listSchema = z
  .object({ items: z.array(ownerBranchSchema), nextCursor: z.string().uuid().nullable() })
  .strict();
const organizationListSchema = z
  .object({ items: z.array(ownerOrganizationSchema), nextCursor: z.string().uuid().nullable() })
  .strict();
const branchListSchema = listSchema;
const publicBranchPageSize = 100;
const maxPublicBranchPages = 100;

export type OrganizationBranchCommandMeta = {
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
};

export type OwnerPageQuery = { cursor?: string; pageSize?: number };

@Injectable()
export class OrganizationBranchClient {
  protected fetcher(input: URL, init: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  async listActiveBranches(): Promise<Branch[]> {
    const branches: Branch[] = [];
    const seenCursors = new Set<string>();
    const seenBranchIds = new Set<string>();
    let cursor: string | undefined;
    let lastSeenBranchId: string | undefined;

    for (let pageNumber = 0; pageNumber < maxPublicBranchPages; pageNumber += 1) {
      const query = new URLSearchParams({ pageSize: String(publicBranchPageSize) });
      if (cursor) query.set('cursor', cursor);
      const result = listSchema.safeParse(
        await this.request(`/internal/v1/public/branches?${query.toString()}`),
      );
      if (!result.success) throw this.contractError();

      for (const ownerBranch of result.data.items) {
        const normalizedId = ownerBranch.id.toLowerCase();
        if (
          seenBranchIds.has(normalizedId) ||
          (lastSeenBranchId !== undefined && normalizedId <= lastSeenBranchId)
        ) {
          throw this.contractError();
        }
        seenBranchIds.add(normalizedId);
        lastSeenBranchId = normalizedId;
        branches.push(mapOwnerBranch(ownerBranch));
      }
      const nextCursor = result.data.nextCursor;
      if (nextCursor === null) return branches;
      if (
        result.data.items.length !== publicBranchPageSize ||
        result.data.items.at(-1)?.id.toLowerCase() !== nextCursor.toLowerCase() ||
        seenCursors.has(nextCursor.toLowerCase()) ||
        nextCursor.toLowerCase() === cursor?.toLowerCase()
      ) {
        throw this.contractError();
      }
      seenCursors.add(nextCursor.toLowerCase());
      cursor = nextCursor;
    }

    throw this.contractError();
  }

  async getActiveBranch(branchId: string): Promise<Branch> {
    const result = ownerBranchSchema.safeParse(
      await this.request(`/internal/v1/public/branches/${encodeURIComponent(branchId)}`),
    );
    if (!result.success) throw this.contractError();
    return mapOwnerBranch(result.data);
  }

  async listOrganizations(page: OwnerPageQuery = {}) {
    const query = new URLSearchParams({ pageSize: String(page.pageSize ?? 25) });
    if (page.cursor) query.set('cursor', page.cursor);
    const result = organizationListSchema.safeParse(
      await this.request(`/internal/v1/organizations?${query.toString()}`),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async getOrganization(organizationId: string) {
    const result = ownerOrganizationSchema.safeParse(
      await this.request(`/internal/v1/organizations/${encodeURIComponent(organizationId)}`),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async createOrganization(
    input: { name: string; slug: string; timezone: string; reason: string },
    meta: OrganizationBranchCommandMeta,
  ) {
    const result = ownerOrganizationSchema.safeParse(
      await this.request('/internal/v1/organizations', {
        method: 'POST',
        body: input,
        command: meta,
      }),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async updateOrganization(
    organizationId: string,
    version: number,
    input: { name?: string; slug?: string; timezone?: string; reason: string },
    meta: OrganizationBranchCommandMeta,
  ) {
    const result = ownerOrganizationSchema.safeParse(
      await this.request(`/internal/v1/organizations/${encodeURIComponent(organizationId)}`, {
        method: 'PATCH',
        body: input,
        version,
        command: meta,
      }),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async changeOrganizationStatus(
    organizationId: string,
    version: number,
    input: { status: 'active' | 'suspended'; reason: string },
    meta: OrganizationBranchCommandMeta,
  ) {
    const result = ownerOrganizationSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/status`,
        { method: 'POST', body: input, version, command: meta },
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async listOrganizationBranches(organizationId: string, page: OwnerPageQuery = {}) {
    const query = new URLSearchParams({ pageSize: String(page.pageSize ?? 25) });
    if (page.cursor) query.set('cursor', page.cursor);
    const result = branchListSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches?${query.toString()}`,
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async getOrganizationBranch(organizationId: string, branchId: string) {
    const result = ownerBranchSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}`,
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async createBranch(
    organizationId: string,
    input: {
      name: string;
      slug: string;
      address: string;
      city: string;
      timezone: string;
      openingHours: Record<string, { open: string; close: string } | null>;
      reason: string;
    },
    meta: OrganizationBranchCommandMeta,
  ) {
    const result = ownerBranchSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches`,
        { method: 'POST', body: input, command: meta },
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async updateBranch(
    organizationId: string,
    branchId: string,
    version: number,
    input: {
      name?: string;
      slug?: string;
      address?: string;
      city?: string;
      timezone?: string;
      openingHours?: Record<string, { open: string; close: string } | null>;
      reason: string;
    },
    meta: OrganizationBranchCommandMeta,
  ) {
    const result = ownerBranchSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}`,
        { method: 'PATCH', body: input, version, command: meta },
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  async changeBranchStatus(
    organizationId: string,
    branchId: string,
    version: number,
    input: { status: 'active' | 'suspended'; reason: string },
    meta: OrganizationBranchCommandMeta,
  ) {
    const result = ownerBranchSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/status`,
        { method: 'POST', body: input, version, command: meta },
      ),
    );
    if (!result.success) throw this.contractError();
    return result.data;
  }

  private async request(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH';
      body?: unknown;
      version?: number;
      command?: OrganizationBranchCommandMeta;
    } = {},
  ): Promise<unknown> {
    const baseUrl = process.env.ORGANIZATION_BRANCH_URL;
    const token = process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN;
    if (!baseUrl || !token || token.length < 32) {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس سازمان و شعبه پیکربندی نشده است.');
    }
    let url: URL;
    try {
      const base = new URL(baseUrl);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        (process.env.NODE_ENV === 'production' &&
          base.protocol !== 'https:' &&
          !isRunflareClusterIpServiceBaseUrl(base))
      )
        throw new Error();
      url = new URL(path, base);
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'نشانی سرویس سازمان و شعبه معتبر نیست.');
    }
    let response: Response;
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'x-funtino-service-id': 'api-gateway',
        'x-funtino-service-token': token,
        'cache-control': 'no-store',
      };
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      if (options.command) {
        headers['x-funtino-actor-user-id'] = options.command.actorUserId;
        headers['x-correlation-id'] = options.command.correlationId;
        headers['idempotency-key'] = options.command.idempotencyKey;
      }
      if (options.version !== undefined) headers['if-match'] = `"${options.version}"`;
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        headers,
        redirect: 'error',
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس سازمان و شعبه در دسترس نیست.');
    }
    if (!response.ok) {
      if (response.status === 404) throw new DomainError('NOT_FOUND', 'مجموعه یا شعبه پیدا نشد.');
      if (response.status === 409)
        throw new DomainError('CONFLICT', 'اطلاعات تغییر کرده است؛ صفحه را تازه کنید.');
      if (response.status === 400 || response.status === 422)
        throw new DomainError('VALIDATION_ERROR', 'اطلاعات ارسالی معتبر نیست.');
      if (response.status === 429)
        throw new DomainError('RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است.');
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'پاسخ سرویس سازمان و شعبه معتبر نیست.');
    }
    try {
      return await response.json();
    } catch {
      throw this.contractError();
    }
  }

  private contractError(): DomainError {
    return new DomainError('DEPENDENCY_UNAVAILABLE', 'قرارداد سرویس سازمان و شعبه ناسازگار است.');
  }
}

function mapOwnerBranch(branch: z.infer<typeof ownerBranchSchema>): Branch {
  if (branch.status !== 'active') {
    throw new DomainError(
      'DEPENDENCY_UNAVAILABLE',
      'سرویس سازمان و شعبه وضعیت شعبه را ناسازگار گزارش کرد.',
    );
  }
  return {
    id: branch.id,
    organizationId: branch.organizationId,
    name: branch.name,
    slug: branch.slug,
    address: branch.address,
    city: branch.city,
    timezone: branch.timezone,
    isActive: true,
    openingHours: branch.openingHours,
  };
}
