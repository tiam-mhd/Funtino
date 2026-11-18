import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const snapshotSchema = z.object({
  status: z.literal('disabled'),
  version: z.null(),
  reasonCode: z.literal('PENDING_WINDOWS_GOLDEN_VECTORS'),
  validFrom: z.null(),
  validUntil: z.null(),
  rules: z.array(z.never()),
}).strict();

@Injectable()
export class PricingSnapshotClient {
  async getBranchSnapshot(branchId: string) {
    const baseUrl = process.env.PRICING_URL;
    const token = process.env.PRICING_DEVICE_INTEGRATION_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512)
      throw new ServiceUnavailableException('Pricing snapshot is not configured.');
    let url: URL;
    try {
      const base = new URL(baseUrl);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
        (process.env.NODE_ENV === 'production' && base.protocol !== 'https:' && !isRunflareClusterIpServiceBaseUrl(base)))
        throw new Error('Invalid Pricing URL');
      url = new URL(`/internal/v1/branches/${encodeURIComponent(branchId)}/offline-snapshot`, base);
    } catch {
      throw new ServiceUnavailableException('Pricing snapshot endpoint is invalid.');
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
      throw new ServiceUnavailableException('Pricing snapshot is unavailable.');
    }
    if (!response.ok) throw new ServiceUnavailableException('Pricing snapshot is unavailable.');
    let value: unknown;
    try { value = await response.json(); } catch {
      throw new ServiceUnavailableException('Pricing snapshot response is invalid.');
    }
    const parsed = snapshotSchema.safeParse(value);
    if (!parsed.success) throw new ServiceUnavailableException('Pricing snapshot response is invalid.');
    return parsed.data;
  }
}
