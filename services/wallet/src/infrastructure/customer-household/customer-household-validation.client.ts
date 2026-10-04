import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';
import type { HouseholdValidator } from '../../application/ports/household-validator.port.js';

const validationSchema = z
  .object({
    householdId: z.string().uuid(),
    status: z.enum(['active', 'suspended', 'archived']),
    version: z.number().int().positive(),
    eligibleForCard: z.boolean(),
  })
  .strict();

@Injectable()
export class CustomerHouseholdValidationClient implements HouseholdValidator {
  async assertActiveHousehold(householdId: string): Promise<void> {
    const configuredUrl = process.env.WALLET_CUSTOMER_HOUSEHOLD_INTERNAL_URL?.trim();
    const token = process.env.WALLET_CUSTOMER_HOUSEHOLD_TOKEN;
    if (!configuredUrl || !token || token.length < 32 || token.length > 512) {
      throw new ServiceUnavailableException('Customer & Household validation is not configured.');
    }

    let endpoint: string;
    try {
      const baseUrl = new URL(configuredUrl);
      if (
        !['http:', 'https:'].includes(baseUrl.protocol) ||
        baseUrl.username ||
        baseUrl.password ||
        baseUrl.search ||
        baseUrl.hash ||
        (process.env.NODE_ENV === 'production' &&
          baseUrl.protocol !== 'https:' &&
          !isRunflareClusterIpServiceBaseUrl(baseUrl))
      ) {
        throw new Error('invalid owner URL');
      }
      baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/u, '')}/internal/v1/households/${encodeURIComponent(householdId)}/validation`;
      endpoint = baseUrl.toString();
    } catch {
      throw new ServiceUnavailableException('Customer & Household validation is not configured.');
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'x-funtino-service-id': 'wallet',
          'x-funtino-service-token': token,
          'cache-control': 'no-store',
          pragma: 'no-cache',
        },
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      throw new ServiceUnavailableException('Customer & Household validation is unavailable.');
    }
    if (response.status === 404) {
      throw new ConflictException('An active household is required for card assignment.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('Customer & Household validation is unavailable.');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException('Customer & Household returned an invalid response.');
    }
    const parsed = validationSchema.safeParse(body);
    if (!parsed.success || parsed.data.householdId.toLowerCase() !== householdId.toLowerCase()) {
      throw new ServiceUnavailableException('Customer & Household response violates its contract.');
    }
    if (parsed.data.status !== 'active' || !parsed.data.eligibleForCard) {
      throw new ConflictException('An active household is required for card assignment.');
    }
  }
}
