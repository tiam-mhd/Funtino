import { Injectable } from '@nestjs/common';
import { DomainError, isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const statusSchema = z.enum(['in_stock', 'assigned', 'blocked', 'retired']);
const cardSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    branchId: uuid,
    maskedIdentifier: z.string().min(1).max(32),
    status: statusSchema,
    verificationStatus: z.enum(['unknown', 'verified', 'rejected']),
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const cardPageSchema = z
  .object({ items: z.array(cardSchema).max(100), nextCursor: uuid.nullable() })
  .strict();
const assignmentSchema = z
  .object({
    id: uuid,
    cardId: uuid,
    organizationId: uuid,
    branchId: uuid,
    householdId: uuid,
    maskedIdentifier: z.string().min(1).max(32),
    status: statusSchema,
    verificationStatus: z.enum(['unknown', 'verified', 'rejected']),
    assignedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const assignmentPageSchema = z
  .object({
    items: z.array(assignmentSchema).max(100),
    nextCursor: uuid.nullable(),
  })
  .strict();
const householdAssignmentPageSchema = assignmentPageSchema;

export type WalletCardInventory = z.infer<typeof cardSchema>;
export type WalletCardPage = z.infer<typeof cardPageSchema>;
export type WalletCardStatus = z.infer<typeof statusSchema>;
export type WalletManualCardStatus = Exclude<WalletCardStatus, 'assigned'>;
export type WalletCardAssignment = z.infer<typeof assignmentSchema>;
export type WalletCardAssignmentPage = z.infer<typeof assignmentPageSchema>;
export type WalletCommandMeta = {
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
};

@Injectable()
export class WalletClient {
  protected fetcher(input: URL, init: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  async listCards(input: {
    organizationId: string;
    branchId: string;
    status?: WalletCardStatus;
    cursor?: string;
    pageSize: number;
  }): Promise<WalletCardPage> {
    const query = new URLSearchParams({ pageSize: String(input.pageSize) });
    if (input.status) query.set('status', input.status);
    if (input.cursor) query.set('cursor', input.cursor);
    const result = cardPageSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(input.organizationId)}/branches/${encodeURIComponent(input.branchId)}/cards?${query}`,
      ),
    );
    if (
      !result.success ||
      result.data.items.some(
        (card) => !this.matchesScope(card, input.organizationId, input.branchId),
      )
    ) {
      throw this.contractError();
    }
    return result.data;
  }

  async registerCard(
    organizationId: string,
    branchId: string,
    input: { externalCardId: string; reason: string },
    meta: WalletCommandMeta,
  ): Promise<WalletCardInventory> {
    const result = cardSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/cards`,
        { method: 'POST', body: input, command: meta },
      ),
    );
    if (!result.success || !this.matchesScope(result.data, organizationId, branchId)) {
      throw this.contractError();
    }
    return result.data;
  }

  async changeCardStatus(
    organizationId: string,
    branchId: string,
    cardId: string,
    version: number,
    input: { status: WalletManualCardStatus; reason: string },
    meta: WalletCommandMeta,
  ): Promise<WalletCardInventory> {
    const result = cardSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/cards/${encodeURIComponent(cardId)}`,
        { method: 'PATCH', body: input, version, command: meta },
      ),
    );
    if (!result.success || !this.matchesScope(result.data, organizationId, branchId)) {
      throw this.contractError();
    }
    return result.data;
  }

  async listBranchAssignments(input: {
    organizationId: string;
    branchId: string;
    cursor?: string;
    pageSize: number;
  }): Promise<WalletCardAssignmentPage> {
    const query = new URLSearchParams({ pageSize: String(input.pageSize) });
    if (input.cursor) query.set('cursor', input.cursor);
    const result = assignmentPageSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(input.organizationId)}/branches/${encodeURIComponent(input.branchId)}/card-assignments?${query}`,
      ),
    );
    if (
      !result.success ||
      result.data.items.some(
        (item) =>
          item.organizationId.toLowerCase() !== input.organizationId.toLowerCase() ||
          item.branchId.toLowerCase() !== input.branchId.toLowerCase(),
      )
    ) {
      throw this.contractError();
    }
    return result.data;
  }

  async listHouseholdAssignments(householdId: string): Promise<WalletCardAssignment[]> {
    const items: WalletCardAssignment[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const query = new URLSearchParams({ pageSize: '100' });
      if (cursor) query.set('cursor', cursor);
      const result = householdAssignmentPageSchema.safeParse(
        await this.request(
          `/internal/v1/households/${encodeURIComponent(householdId)}/card-assignments?${query}`,
        ),
      );
      if (!result.success) throw this.contractError();
      for (const assignment of result.data.items) {
        const normalizedId = assignment.id.toLowerCase();
        if (
          assignment.householdId.toLowerCase() !== householdId.toLowerCase() ||
          seenIds.has(normalizedId)
        )
          throw this.contractError();
        seenIds.add(normalizedId);
        items.push(assignment);
      }
      const nextCursor = result.data.nextCursor;
      if (nextCursor === null) return items;
      if (
        result.data.items.length !== 100 ||
        result.data.items.at(-1)?.id.toLowerCase() !== nextCursor.toLowerCase() ||
        seenCursors.has(nextCursor.toLowerCase()) ||
        nextCursor.toLowerCase() === cursor?.toLowerCase()
      )
        throw this.contractError();
      seenCursors.add(nextCursor.toLowerCase());
      cursor = nextCursor;
    }
    throw this.contractError();
  }

  async getAssignment(assignmentId: string): Promise<WalletCardAssignment> {
    const result = assignmentSchema.safeParse(
      await this.request(`/internal/v1/assignments/${encodeURIComponent(assignmentId)}`),
    );
    if (!result.success || result.data.id.toLowerCase() !== assignmentId.toLowerCase()) {
      throw this.contractError();
    }
    return result.data;
  }

  async assignCard(
    organizationId: string,
    branchId: string,
    cardId: string,
    input: { householdId: string; reason: string },
    meta: WalletCommandMeta,
  ): Promise<WalletCardAssignment> {
    const result = assignmentSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/cards/${encodeURIComponent(cardId)}/assignments`,
        { method: 'POST', body: input, command: meta },
      ),
    );
    if (
      !result.success ||
      result.data.organizationId.toLowerCase() !== organizationId.toLowerCase() ||
      result.data.branchId.toLowerCase() !== branchId.toLowerCase() ||
      result.data.cardId.toLowerCase() !== cardId.toLowerCase() ||
      result.data.householdId.toLowerCase() !== input.householdId.toLowerCase()
    ) {
      throw this.contractError();
    }
    return result.data;
  }

  async transferAssignment(
    organizationId: string,
    branchId: string,
    assignmentId: string,
    input: { householdId: string; reason: string },
    meta: WalletCommandMeta,
  ): Promise<WalletCardAssignment> {
    const result = assignmentSchema.safeParse(
      await this.request(
        `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/card-assignments/${encodeURIComponent(assignmentId)}/transfer`,
        { method: 'POST', body: input, command: meta },
      ),
    );
    if (
      !result.success ||
      result.data.organizationId.toLowerCase() !== organizationId.toLowerCase() ||
      result.data.branchId.toLowerCase() !== branchId.toLowerCase() ||
      result.data.householdId.toLowerCase() !== input.householdId.toLowerCase()
    ) {
      throw this.contractError();
    }
    return result.data;
  }

  async cancelAssignment(
    organizationId: string,
    branchId: string,
    assignmentId: string,
    input: { reason: string },
    meta: WalletCommandMeta,
  ): Promise<{ assignmentId: string; status: 'cancelled' }> {
    const result = z
      .object({ assignmentId: uuid, status: z.literal('cancelled') })
      .strict()
      .safeParse(
        await this.request(
          `/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/card-assignments/${encodeURIComponent(assignmentId)}/cancel`,
          { method: 'POST', body: input, command: meta },
        ),
      );
    if (!result.success || result.data.assignmentId.toLowerCase() !== assignmentId.toLowerCase()) {
      throw this.contractError();
    }
    return result.data;
  }

  private async request(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH';
      body?: unknown;
      version?: number;
      command?: WalletCommandMeta;
    } = {},
  ): Promise<unknown> {
    const baseUrl = process.env.WALLET_URL;
    const token = process.env.WALLET_GATEWAY_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512) {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس موجودی کارت پیکربندی نشده است.');
    }

    let url: URL;
    try {
      const base = new URL(baseUrl);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        base.pathname !== '/' ||
        (process.env.NODE_ENV === 'production' &&
          base.protocol !== 'https:' &&
          !isRunflareClusterIpServiceBaseUrl(base))
      ) {
        throw new Error('Invalid Wallet URL');
      }
      url = new URL(path, base);
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'نشانی سرویس موجودی کارت معتبر نیست.');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-funtino-service-id': 'api-gateway',
      'x-funtino-service-token': token,
      'cache-control': 'no-store',
      pragma: 'no-cache',
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.command) {
      headers['x-funtino-actor-user-id'] = options.command.actorUserId;
      headers['x-correlation-id'] = options.command.correlationId;
      headers['idempotency-key'] = options.command.idempotencyKey;
    }
    if (options.version !== undefined) headers['if-match'] = String(options.version);

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        headers,
        redirect: 'error',
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس موجودی کارت در دسترس نیست.');
    }

    if (!response.ok) {
      if (response.status === 404)
        throw new DomainError('NOT_FOUND', 'کارت، مجموعه یا شعبه پیدا نشد.');
      if (response.status === 409)
        throw new DomainError('CONFLICT', 'وضعیت کارت تغییر کرده است؛ فهرست را تازه کنید.');
      if (response.status === 400 || response.status === 422) {
        throw new DomainError('VALIDATION_ERROR', 'اطلاعات ارسالی برای کارت معتبر نیست.');
      }
      if (response.status === 429)
        throw new DomainError('RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است.');
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'پاسخ سرویس موجودی کارت معتبر نیست.');
    }

    try {
      return await response.json();
    } catch {
      throw this.contractError();
    }
  }

  private contractError(): DomainError {
    return new DomainError('DEPENDENCY_UNAVAILABLE', 'قرارداد سرویس موجودی کارت ناسازگار است.');
  }

  private matchesScope(card: WalletCardInventory, organizationId: string, branchId: string) {
    return (
      card.organizationId.toLowerCase() === organizationId.toLowerCase() &&
      card.branchId.toLowerCase() === branchId.toLowerCase()
    );
  }
}
