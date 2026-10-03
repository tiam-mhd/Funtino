import { Injectable } from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const memberSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    displayName: z.string().min(2).max(80),
    relationship: z.string().min(2).max(40),
    birthDate: z.string().date().nullable(),
    status: z.enum(['active', 'archived']),
    isDependent: z.boolean(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const householdSchema = z
  .object({
    id: uuid,
    name: z.string().min(2).max(80),
    status: z.enum(['active', 'suspended', 'archived']),
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    members: z.array(memberSchema),
  })
  .strict();
const householdListSchema = z.object({ items: z.array(householdSchema).max(200) }).strict();
const createdHouseholdSchema = householdSchema.omit({ members: true }).strict();
const createdMemberSchema = memberSchema;

export type CustomerHousehold = z.infer<typeof householdSchema>;
export type CustomerHouseholdMemberInput = {
  displayName: string;
  relationship: string;
  birthDate?: string | null;
  isDependent?: boolean;
};

@Injectable()
export class CustomerHouseholdClient {
  protected fetcher(input: URL, init: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  async listHouseholdsForUser(userId: string): Promise<CustomerHousehold[]> {
    const parsed = householdListSchema.safeParse(
      await this.request(`/internal/v1/users/${encodeURIComponent(userId)}/households`),
    );
    if (!parsed.success) throw this.contractError();
    return parsed.data.items;
  }

  async createHousehold(
    userId: string,
    name: string,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = createdHouseholdSchema.safeParse(
      await this.request('/internal/v1/households', {
        method: 'POST',
        userId,
        correlationId: meta.correlationId,
        idempotencyKey: meta.idempotencyKey,
        body: { ownerUserId: userId, name },
      }),
    );
    if (!parsed.success) throw this.contractError();
    return parsed.data;
  }

  async addMember(
    userId: string,
    householdId: string,
    input: CustomerHouseholdMemberInput,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = createdMemberSchema.safeParse(
      await this.request(`/internal/v1/households/${encodeURIComponent(householdId)}/members`, {
        method: 'POST',
        userId,
        correlationId: meta.correlationId,
        idempotencyKey: meta.idempotencyKey,
        body: input,
      }),
    );
    if (!parsed.success || parsed.data.householdId.toLowerCase() !== householdId.toLowerCase()) {
      throw this.contractError();
    }
    return parsed.data;
  }

  private async request(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      userId?: string;
      correlationId?: string;
      idempotencyKey?: string;
      body?: unknown;
    } = {},
  ): Promise<unknown> {
    const baseUrl = process.env.CUSTOMER_HOUSEHOLD_URL;
    const token = process.env.CUSTOMER_HOUSEHOLD_GATEWAY_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512) {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس مدیریت خانواده پیکربندی نشده است.');
    }

    let endpoint: URL;
    try {
      const base = new URL(baseUrl);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        base.pathname !== '/' ||
        (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')
      ) {
        throw new Error('Invalid Customer & Household URL');
      }
      endpoint = new URL(path, base);
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'نشانی سرویس مدیریت خانواده معتبر نیست.');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-funtino-service-id': 'api-gateway',
      'x-funtino-service-token': token,
      'cache-control': 'no-store',
      pragma: 'no-cache',
    };
    if (options.userId) headers['x-funtino-actor-user-id'] = options.userId;
    if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: options.method ?? 'GET',
        headers,
        redirect: 'error',
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس مدیریت خانواده در دسترس نیست.');
    }
    if (!response.ok) {
      if (response.status === 404) throw new DomainError('NOT_FOUND', 'خانواده پیدا نشد.');
      if (response.status === 403)
        throw new DomainError('FORBIDDEN', 'دسترسی به این خانواده مجاز نیست.');
      if (response.status === 409)
        throw new DomainError('CONFLICT', 'تغییر خانواده با وضعیت فعلی سازگار نیست.');
      if (response.status === 400)
        throw new DomainError('VALIDATION_ERROR', 'اطلاعات خانواده معتبر نیست.');
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'پاسخ سرویس مدیریت خانواده معتبر نیست.');
    }
    try {
      return await response.json();
    } catch {
      throw this.contractError();
    }
  }

  private contractError(): DomainError {
    return new DomainError('DEPENDENCY_UNAVAILABLE', 'قرارداد سرویس مدیریت خانواده ناسازگار است.');
  }
}
