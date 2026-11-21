import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const cardAssignmentSchema = z
  .object({
    id: uuid,
    cardId: uuid,
    organizationId: uuid,
    branchId: uuid,
    householdId: uuid,
    memberId: uuid.nullable(),
    maskedIdentifier: z.string().min(1).max(32),
    status: z.enum(['in_stock', 'assigned', 'blocked', 'retired']),
    verificationStatus: z.enum(['unknown', 'verified', 'rejected']),
    assignedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const cardInventorySchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    branchId: uuid,
    maskedIdentifier: z.string().min(1).max(32),
    status: z.enum(['in_stock', 'assigned', 'blocked', 'retired']),
    verificationStatus: z.enum(['unknown', 'verified', 'rejected']),
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const lifecycleRequestSchema = z
  .object({
    id: uuid,
    cardId: uuid,
    replacementCardId: uuid.nullable(),
    householdId: uuid,
    memberId: uuid.nullable(),
    action: z.enum(['lost', 'replacement']),
    status: z.enum(['requested', 'in_review', 'approved', 'rejected', 'completed']),
    reason: z.string().max(500),
    createdAt: z.string().datetime({ offset: true }),
    duplicate: z.boolean().optional(),
  })
  .strict();

@Injectable()
export class EdgeCardOperationsClient {
  async assign(input: {
    organizationId: string;
    branchId: string;
    cardId: string;
    householdId: string;
    memberId: string | null;
    expectedVersion: number;
    reason: string;
    actorUserId: string;
    correlationId: string;
    idempotencyKey: string;
  }) {
    const result = cardAssignmentSchema.safeParse(
      await this.request({
        path: `/internal/v1/organizations/${encodeURIComponent(input.organizationId)}/branches/${encodeURIComponent(input.branchId)}/cards/${encodeURIComponent(input.cardId)}/assignments`,
        method: 'POST',
        body: {
          householdId: input.householdId,
          memberId: input.memberId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        },
        actorUserId: input.actorUserId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    if (
      !result.success ||
      result.data.organizationId.toLowerCase() !== input.organizationId.toLowerCase() ||
      result.data.branchId.toLowerCase() !== input.branchId.toLowerCase() ||
      result.data.cardId.toLowerCase() !== input.cardId.toLowerCase() ||
      result.data.householdId.toLowerCase() !== input.householdId.toLowerCase() ||
      result.data.memberId?.toLowerCase() !== input.memberId?.toLowerCase() ||
      result.data.status !== 'assigned' ||
      result.data.verificationStatus !== 'verified'
    ) {
      throw new ServiceUnavailableException('Wallet card assignment response is invalid.');
    }
    return result.data;
  }

  async block(input: {
    organizationId: string;
    branchId: string;
    cardId: string;
    expectedVersion: number;
    reason: string;
    actorUserId: string;
    correlationId: string;
    idempotencyKey: string;
  }) {
    const result = cardInventorySchema.safeParse(
      await this.request({
        path: `/internal/v1/organizations/${encodeURIComponent(input.organizationId)}/branches/${encodeURIComponent(input.branchId)}/cards/${encodeURIComponent(input.cardId)}`,
        method: 'PATCH',
        body: { status: 'blocked', reason: input.reason },
        actorUserId: input.actorUserId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        ifMatch: String(input.expectedVersion),
      }),
    );
    if (
      !result.success ||
      result.data.organizationId.toLowerCase() !== input.organizationId.toLowerCase() ||
      result.data.branchId.toLowerCase() !== input.branchId.toLowerCase() ||
      result.data.id.toLowerCase() !== input.cardId.toLowerCase() ||
      result.data.status !== 'blocked'
    ) {
      throw new ServiceUnavailableException('Wallet card block response is invalid.');
    }
    return result.data;
  }

  async requestReplacement(input: {
    householdId: string;
    cardId: string;
    expectedVersion: number;
    reason: string;
    actorUserId: string;
    correlationId: string;
    idempotencyKey: string;
  }) {
    const result = lifecycleRequestSchema.safeParse(
      await this.request({
        path: `/internal/v1/households/${encodeURIComponent(input.householdId)}/cards/${encodeURIComponent(input.cardId)}/lifecycle-requests`,
        method: 'POST',
        body: {
          action: 'replacement',
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        },
        actorUserId: input.actorUserId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
      }),
    );
    if (
      !result.success ||
      result.data.householdId.toLowerCase() !== input.householdId.toLowerCase() ||
      result.data.cardId.toLowerCase() !== input.cardId.toLowerCase() ||
      result.data.action !== 'replacement' ||
      !['requested', 'in_review', 'approved'].includes(result.data.status)
    ) {
      throw new ServiceUnavailableException('Wallet card replacement response is invalid.');
    }
    return result.data;
  }

  private async request(input: {
    path: string;
    method: 'POST' | 'PATCH';
    body: Record<string, unknown>;
    actorUserId: string;
    correlationId: string;
    idempotencyKey: string;
    ifMatch?: string;
  }): Promise<unknown> {
    const baseUrl = process.env.WALLET_URL?.trim();
    const token = process.env.WALLET_DEVICE_INTEGRATION_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512)
      throw new ServiceUnavailableException('Wallet card operations are not configured.');

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
        throw new Error('Invalid Wallet URL');
      url = new URL(input.path, base.origin);
    } catch {
      throw new ServiceUnavailableException('Wallet card operations endpoint is invalid.');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: input.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-funtino-service-id': 'device-integration',
          'x-funtino-service-token': token,
          'x-funtino-actor-user-id': input.actorUserId,
          'x-correlation-id': input.correlationId,
          'idempotency-key': input.idempotencyKey,
          ...(input.ifMatch ? { 'if-match': input.ifMatch } : {}),
          'cache-control': 'no-store',
        },
        body: JSON.stringify(input.body),
        redirect: 'error',
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException('Wallet card operations are unavailable.');
    }
    if (response.status === 409)
      throw new ConflictException('Wallet rejected the card operation because its state changed.');
    if (response.status === 404)
      throw new NotFoundException('The card or household was not found in the authorized scope.');
    if (!response.ok) throw new ServiceUnavailableException('Wallet rejected the card operation.');
    try {
      return await response.json();
    } catch {
      throw new ServiceUnavailableException('Wallet card operations response is invalid.');
    }
  }
}
