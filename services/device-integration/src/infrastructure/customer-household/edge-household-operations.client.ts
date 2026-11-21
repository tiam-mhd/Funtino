import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const searchResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            customerId: uuid,
            displayName: z.string().min(1).max(160),
            maskedPhone: z.string().max(24).nullable(),
            householdId: uuid,
            memberId: uuid.nullable(),
            recordVersion: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(100),
    nextCursor: uuid.nullable(),
  })
  .strict();
const profileResponseSchema = z
  .object({
    customerId: uuid,
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    birthDate: z.string().date().nullable(),
    gender: z.enum(['female', 'male', 'other', 'prefer_not_to_say']).nullable(),
    city: z.string().nullable(),
    avatarPreset: z.string().nullable(),
    hasUploadedAvatar: z.boolean(),
    profileCompleted: z.boolean(),
    recordVersion: z.number().int().positive(),
  })
  .strict();
type SearchResponse = z.infer<typeof searchResponseSchema>;
type ProfileResponse = z.infer<typeof profileResponseSchema>;
type HouseholdResponse = z.infer<typeof householdResponseSchema>;
type ProfileMutationResponse = z.infer<typeof profileMutationResponseSchema>;
type HouseholdMutationResponse = z.infer<typeof householdMutationResponseSchema>;
type MemberMutationResponse = z.infer<typeof memberMutationResponseSchema>;
const householdResponseSchema = z
  .object({
    id: uuid,
    name: z.string(),
    status: z.enum(['active', 'suspended', 'archived']),
    recordVersion: z.number().int().positive(),
    members: z.array(
      z
        .object({
          id: uuid,
          displayName: z.string(),
          relationship: z.string(),
          birthDate: z.string().date().nullable(),
          isDependent: z.boolean(),
          status: z.enum(['active', 'pending', 'archived']),
          recordVersion: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
const profileMutationResponseSchema = z
  .object({
    userId: uuid,
    version: z.number().int().positive(),
  })
  .passthrough();
const householdMutationResponseSchema = z
  .object({
    id: uuid,
    version: z.number().int().positive(),
  })
  .passthrough();
const memberMutationResponseSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    version: z.number().int().positive(),
  })
  .passthrough();

@Injectable()
export class EdgeHouseholdOperationsClient {
  async search(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    query: string;
    cursor?: string;
    pageSize: number;
  }) {
    const { actorUserId, correlationId, ...body } = input;
    return this.request<SearchResponse>('POST', '/internal/v1/edge/customers/search', body, {
      actorUserId,
      correlationId,
    });
  }

  async readCustomer(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    householdIds: string[];
    customerId: string;
  }) {
    const { customerId, actorUserId, correlationId, ...body } = input;
    return this.request<ProfileResponse>(
      'POST',
      `/internal/v1/edge/customers/${encodeURIComponent(customerId)}/read`,
      body,
      { actorUserId, correlationId },
    );
  }

  async readHousehold(input: {
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    householdId: string;
  }) {
    const query = new URLSearchParams({
      sourceInstanceId: input.sourceInstanceId,
      branchId: input.branchId,
    });
    return this.request<HouseholdResponse>(
      'GET',
      `/internal/v1/edge/households/${encodeURIComponent(input.householdId)}?${query}`,
      undefined,
      { actorUserId: input.actorUserId, correlationId: input.correlationId },
    );
  }

  async updateCustomer(
    input: Record<string, unknown> & {
      customerId: string;
      actorUserId: string;
      correlationId: string;
      idempotencyKey: string;
    },
  ) {
    const { customerId, actorUserId, correlationId, idempotencyKey, ...body } = input;
    return this.request<ProfileMutationResponse>(
      'PATCH',
      `/internal/v1/edge/customers/${encodeURIComponent(customerId)}`,
      body,
      {
        actorUserId,
        correlationId,
        idempotencyKey,
      },
    );
  }

  async updateHousehold(
    input: Record<string, unknown> & {
      householdId: string;
      actorUserId: string;
      correlationId: string;
      idempotencyKey: string;
    },
  ) {
    const { householdId, actorUserId, correlationId, idempotencyKey, ...body } = input;
    return this.request<HouseholdMutationResponse>(
      'PATCH',
      `/internal/v1/edge/households/${encodeURIComponent(householdId)}`,
      body,
      {
        actorUserId,
        correlationId,
        idempotencyKey,
      },
    );
  }

  async addMember(
    input: Record<string, unknown> & {
      householdId: string;
      actorUserId: string;
      correlationId: string;
      idempotencyKey: string;
    },
  ) {
    const { householdId, actorUserId, correlationId, idempotencyKey, ...body } = input;
    return this.request<MemberMutationResponse>(
      'POST',
      `/internal/v1/edge/households/${encodeURIComponent(householdId)}/members`,
      body,
      {
        actorUserId,
        correlationId,
        idempotencyKey,
      },
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    context: { actorUserId: string; correlationId: string; idempotencyKey?: string },
  ): Promise<T> {
    const baseUrl = process.env.CUSTOMER_HOUSEHOLD_INTERNAL_URL?.trim();
    const token = process.env.DEVICE_INTEGRATION_CUSTOMER_HOUSEHOLD_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512)
      throw new ServiceUnavailableException('Customer & Household Edge access is not configured.');
    let url: URL;
    try {
      const base = new URL(baseUrl);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.pathname !== '/' ||
        base.search ||
        base.hash ||
        (process.env.NODE_ENV === 'production' &&
          base.protocol !== 'https:' &&
          !isRunflareClusterIpServiceBaseUrl(base))
      )
        throw new Error('Invalid Customer & Household URL');
      url = new URL(path, base);
    } catch {
      throw new ServiceUnavailableException('Customer & Household Edge endpoint is invalid.');
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          'x-funtino-service-id': 'device-integration',
          'x-funtino-service-token': token,
          'x-funtino-actor-user-id': context.actorUserId,
          'x-correlation-id': context.correlationId,
          ...(context.idempotencyKey ? { 'idempotency-key': context.idempotencyKey } : {}),
          'cache-control': 'no-store',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException('Customer & Household Edge owner is unavailable.');
    }
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 404)
        throw new ServiceUnavailableException('Customer record is outside this branch.');
      if (response.status === 409)
        throw new ServiceUnavailableException('Customer data changed; reload before retrying.');
      throw new ServiceUnavailableException('Customer & Household Edge request was rejected.');
    }
    const schema = path.includes('/customers/search')
      ? searchResponseSchema
      : path.includes('/read')
        ? profileResponseSchema
        : path.includes('/members')
          ? memberMutationResponseSchema
          : path.includes('/households/') && method === 'GET'
            ? householdResponseSchema
            : path.includes('/households/')
              ? householdMutationResponseSchema
              : profileMutationResponseSchema;
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new ServiceUnavailableException('Customer & Household Edge response is invalid.');
    return parsed.data as T;
  }
}
