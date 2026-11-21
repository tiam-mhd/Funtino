import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const responseSchema = z
  .object({
    provisionalId: uuid,
    sourceInstanceId: uuid,
    branchId: uuid,
    status: z.enum(['pending_review', 'linked', 'rejected']),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

@Injectable()
export class EdgeProvisionalCustomerClient {
  async create(input: {
    provisionalId: string;
    sourceInstanceId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
    idempotencyKey: string;
  }) {
    const config = this.configuration();
    const url = new URL('/internal/v1/edge/provisional-customers', `${config.baseUrl}/`);
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
          'x-funtino-actor-user-id': input.actorUserId,
          'x-correlation-id': input.correlationId,
          'idempotency-key': input.idempotencyKey,
          'cache-control': 'no-store',
        },
        body: JSON.stringify({
          provisionalId: input.provisionalId,
          sourceInstanceId: input.sourceInstanceId,
          branchId: input.branchId,
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException('Customer record owner is unavailable.');
    }
    if (!response.ok) {
      if (response.status === 409)
        throw new ServiceUnavailableException(
          'Provisional customer record conflicts with its prior state.',
        );
      if (response.status >= 500)
        throw new ServiceUnavailableException('Customer record owner is unavailable.');
      throw new ServiceUnavailableException('Customer record owner rejected the request.');
    }
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (
      !parsed.success ||
      parsed.data.provisionalId !== input.provisionalId ||
      parsed.data.sourceInstanceId !== input.sourceInstanceId ||
      parsed.data.branchId !== input.branchId
    ) {
      throw new ServiceUnavailableException('Customer record owner response is invalid.');
    }
    return parsed.data;
  }

  private configuration() {
    const baseUrl = process.env.CUSTOMER_HOUSEHOLD_INTERNAL_URL?.trim();
    const token = process.env.DEVICE_INTEGRATION_CUSTOMER_HOUSEHOLD_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512) {
      throw new ServiceUnavailableException('Customer record owner is not configured.');
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
        throw new Error('Invalid Customer & Household URL');
      }
      return { baseUrl: base.origin, token };
    } catch {
      throw new ServiceUnavailableException('Customer record owner is not configured.');
    }
  }
}
