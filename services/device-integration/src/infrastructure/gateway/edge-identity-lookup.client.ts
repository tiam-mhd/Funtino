import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const responseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            customerId: z.string().uuid(),
            maskedPhone: z
              .string()
              .min(1)
              .max(24)
              .regex(/.*[•*xX].*/u),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

@Injectable()
export class EdgeIdentityLookupClient {
  async lookup(userIds: string[]) {
    if (!userIds.length) return new Map<string, string>();
    const token = process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
    const baseUrl = process.env.API_GATEWAY_INTERNAL_URL?.trim();
    if (!token || token.length < 32 || token.length > 512 || !baseUrl) {
      throw new ServiceUnavailableException('Gateway identity lookup is not configured.');
    }
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
        throw new Error('Invalid Gateway URL');
      url = new URL('/internal/v1/edge/identities/lookup', base);
    } catch {
      throw new ServiceUnavailableException('Gateway identity lookup is not configured.');
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-funtino-service-id': 'device-integration',
          'x-funtino-service-token': token,
          'cache-control': 'no-store',
        },
        body: JSON.stringify({ userIds: [...new Set(userIds)].slice(0, 100) }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException('Gateway identity lookup is unavailable.');
    }
    if (!response.ok) throw new ServiceUnavailableException('Gateway identity lookup failed.');
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success)
      throw new ServiceUnavailableException('Gateway identity response is invalid.');
    return new Map(
      parsed.data.items.map((item) => [item.customerId.toLowerCase(), item.maskedPhone]),
    );
  }
}
