import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';
import type { EdgeOperatorPairingRecord } from '../../application/ports/edge-operator-pairing.repository.js';

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
    token: z.string().min(32).max(256),
    tokenId: uuid,
    organizationId: uuid,
    branchId: uuid,
    permissionKeys: z.array(permission).min(1).max(10),
    expiresAt: z.string().datetime({ offset: true }),
    policyVersion: z.number().int().positive(),
    catalogVersion: z.number().int().positive(),
  })
  .strict();

@Injectable()
export class EdgeOperatorPairingGatewayClient {
  async redeem(pairing: EdgeOperatorPairingRecord) {
    if (!pairing.actorUserId || !pairing.managementSessionId || !pairing.permissionKeys?.length)
      throw new ServiceUnavailableException('Pairing approval is incomplete.');
    const token = process.env.DEVICE_INTEGRATION_EDGE_OPERATOR_PAIRING_TOKEN;
    const baseUrl = process.env.API_GATEWAY_INTERNAL_URL?.trim();
    if (!token || token.length < 32 || token.length > 512 || !baseUrl)
      throw new ServiceUnavailableException('Operator pairing redemption is not configured.');
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
      url = new URL('/internal/v1/edge/operator-pairings/redeem', base);
    } catch {
      throw new ServiceUnavailableException('Operator pairing redemption is not configured.');
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
        body: JSON.stringify({
          pairingId: pairing.id,
          actorUserId: pairing.actorUserId,
          managementSessionId: pairing.managementSessionId,
          organizationId: pairing.organizationId,
          branchId: pairing.branchId,
          permissionKeys: pairing.permissionKeys,
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Operator authorization is unavailable. Start a new pairing.',
      );
    }
    if (!response.ok)
      throw new ServiceUnavailableException('Operator authorization failed. Start a new pairing.');
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (
      !parsed.success ||
      parsed.data.organizationId.toLowerCase() !== pairing.organizationId.toLowerCase() ||
      parsed.data.branchId.toLowerCase() !== pairing.branchId.toLowerCase() ||
      parsed.data.permissionKeys.length !== pairing.permissionKeys.length ||
      parsed.data.permissionKeys.some((item) => !pairing.permissionKeys?.includes(item))
    )
      throw new ServiceUnavailableException(
        'Operator authorization response is invalid. Start a new pairing.',
      );
    return parsed.data;
  }
}
