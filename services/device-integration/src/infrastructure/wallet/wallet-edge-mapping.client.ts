import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const mappingsSchema = z.array(z.object({
  cardId: z.string().uuid(),
  externalCardId: z.string().min(1).max(160),
  householdId: z.string().uuid(),
  memberId: z.string().uuid().nullable(),
}).strict()).max(20_000);
const reconciliationResultSchema = z.object({
  snapshotId: z.string().uuid(),
  cardId: z.string().uuid(),
  balanceRial: z.number().int().safe().nullable(),
  differenceRial: z.number().int().safe().nullable(),
  freshness: z.enum(['fresh', 'pending_sync', 'stale', 'unknown']),
  observedAt: z.string().datetime({ offset: true }),
  duplicate: z.boolean(),
}).strict();

@Injectable()
export class WalletEdgeMappingClient {
  async listMappings(organizationId: string, branchId: string) {
    const baseUrl = process.env.WALLET_URL;
    const token = process.env.WALLET_DEVICE_INTEGRATION_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512)
      throw new ServiceUnavailableException('Wallet Edge mapping is not configured.');
    let url: URL;
    try {
      const base = new URL(baseUrl);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
        (process.env.NODE_ENV === 'production' && base.protocol !== 'https:' && !isRunflareClusterIpServiceBaseUrl(base)))
        throw new Error('Invalid Wallet URL');
      url = new URL(`/internal/v1/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/edge-card-mappings`, base);
    } catch {
      throw new ServiceUnavailableException('Wallet Edge mapping endpoint is invalid.');
    }
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'x-funtino-service-id': 'device-integration',
          'x-funtino-service-token': token,
          'cache-control': 'no-store',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException('Wallet Edge mapping is unavailable.');
    }
    if (!response.ok) throw new ServiceUnavailableException('Wallet Edge mapping is unavailable.');
    let value: unknown;
    try { value = await response.json(); } catch {
      throw new ServiceUnavailableException('Wallet Edge mapping response is invalid.');
    }
    const parsed = mappingsSchema.safeParse(value);
    if (!parsed.success) throw new ServiceUnavailableException('Wallet Edge mapping response is invalid.');
    return parsed.data;
  }

  async reconcileBalanceSnapshot(input: {
    snapshotId: string;
    sourceInstanceId: string;
    organizationId: string;
    branchId: string;
    cardId: string;
    householdId: string;
    memberId: string | null;
    snapshotVersion: string;
    localSequence: number;
    balanceRial: number;
    currencyCode: 'IRR';
    observedAt: string;
  }) {
    const baseUrl = process.env.WALLET_URL;
    const token = process.env.WALLET_DEVICE_INTEGRATION_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512)
      throw new ServiceUnavailableException('Wallet balance reconciliation is not configured.');
    let url: URL;
    try {
      const base = new URL(baseUrl);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
        (process.env.NODE_ENV === 'production' && base.protocol !== 'https:' && !isRunflareClusterIpServiceBaseUrl(base)))
        throw new Error('Invalid Wallet URL');
      url = new URL('/internal/v2/edge/balances/reconcile', base);
    } catch {
      throw new ServiceUnavailableException('Wallet balance reconciliation endpoint is invalid.');
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-funtino-service-id': 'device-integration',
          'x-funtino-service-token': token,
          'cache-control': 'no-store',
        },
        body: JSON.stringify(input),
        redirect: 'error',
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException('Wallet balance reconciliation is unavailable.');
    }
    if (response.status === 409)
      throw new ConflictException('Wallet rejected the physical balance snapshot for reconciliation.');
    if (!response.ok) throw new ServiceUnavailableException('Wallet balance reconciliation was rejected.');
    let value: unknown;
    try { value = await response.json(); } catch {
      throw new ServiceUnavailableException('Wallet balance reconciliation response is invalid.');
    }
    const parsed = reconciliationResultSchema.safeParse(value);
    if (!parsed.success || parsed.data.snapshotId.toLowerCase() !== input.snapshotId.toLowerCase() ||
      parsed.data.cardId.toLowerCase() !== input.cardId.toLowerCase())
      throw new ServiceUnavailableException('Wallet balance reconciliation response is invalid.');
    return parsed.data;
  }
}
