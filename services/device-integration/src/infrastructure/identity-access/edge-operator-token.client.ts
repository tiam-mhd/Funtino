import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const permission = z.enum([
  'card.inventory.read',
  'card.inventory.manage',
  'card.assign',
  'card.transfer',
  'card.unassign',
  'customer.lookup.limited',
  'customer.provisional.create',
  'customer.family.read',
  'customer.family.manage',
  'customer.profile.manage',
]);
const responseSchema = z
  .object({
    tokenId: uuid,
    actorUserId: uuid,
    organizationId: uuid,
    branchId: uuid,
    permission,
    expiresAt: z.string().datetime({ offset: true }),
    policyVersion: z.number().int().positive(),
    catalogVersion: z.number().int().positive(),
  })
  .strict();

@Injectable()
export class EdgeOperatorTokenClient {
  async validate(token: string, branchId: string, requiredPermission: z.infer<typeof permission>) {
    const config = this.configuration();
    const url = new URL('/internal/v1/edge-operator-tokens/validate', `${config.baseUrl}/`);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-funtino-service-id': 'device-integration',
          'x-funtino-service-token': config.token,
          'cache-control': 'no-store',
        },
        body: JSON.stringify({ token, branchId, permission: requiredPermission }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException('Operator authorization is unavailable.');
    }
    if (response.status === 401)
      throw new UnauthorizedException('Edge operator token is invalid or expired.');
    if (response.status === 403)
      throw new UnauthorizedException('Edge operator permission is not active.');
    if (!response.ok)
      throw new ServiceUnavailableException('Operator authorization is unavailable.');
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (
      !parsed.success ||
      parsed.data.branchId.toLowerCase() !== branchId.toLowerCase() ||
      parsed.data.permission !== requiredPermission
    ) {
      throw new ServiceUnavailableException('Operator authorization response is invalid.');
    }
    return parsed.data;
  }

  private configuration() {
    const baseUrl = process.env.IDENTITY_ACCESS_URL?.trim();
    const token = process.env.DEVICE_INTEGRATION_IDENTITY_ACCESS_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512) {
      throw new ServiceUnavailableException('Operator authorization is not configured.');
    }
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
      ) {
        throw new Error('Invalid IAM URL');
      }
      return { baseUrl: base.origin, token };
    } catch {
      throw new ServiceUnavailableException('Operator authorization is not configured.');
    }
  }
}
