import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';
import type {
  OrganizationScopeOwner,
  OrganizationScopeValidation,
  TenantAccessScope,
} from '../../application/ports/organization-scope-owner.port.js';

const ownerResponseSchema = z.discriminatedUnion('valid', [
  z.object({ valid: z.literal(false), reason: z.string().min(1).optional() }).strict(),
  z
    .object({
      valid: z.literal(true),
      organizationId: z.string().uuid(),
      organizationVersion: z.number().int().min(1),
      branchId: z.string().uuid().optional(),
      branchVersion: z.number().int().min(1).optional(),
    })
    .strict(),
]);

type RuntimeConfiguration = { baseUrl: string; token: string };

function runtimeConfiguration(): RuntimeConfiguration | null {
  const rawBaseUrl = process.env.ORGANIZATION_BRANCH_URL?.trim();
  const token = process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN;
  if (!rawBaseUrl || !token || token.length < 32 || token.length > 512) return null;

  try {
    const parsed = new URL(rawBaseUrl);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      (process.env.NODE_ENV === 'production' &&
        parsed.protocol !== 'https:' &&
        !isRunflareClusterIpServiceBaseUrl(parsed)) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return { baseUrl: parsed.origin, token };
  } catch {
    return null;
  }
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

@Injectable()
export class OrganizationScopeOwnerClient implements OrganizationScopeOwner {
  isConfigured(): boolean {
    return runtimeConfiguration() !== null;
  }

  async validateScope(scope: TenantAccessScope): Promise<OrganizationScopeValidation> {
    const config = runtimeConfiguration();
    if (!config) {
      throw new ServiceUnavailableException(
        'Organization/branch scope validation is not configured.',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/internal/v1/scopes/validate`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-funtino-service-id': 'identity-access',
          'x-funtino-service-token': config.token,
        },
        body: JSON.stringify(
          scope.type === 'organization'
            ? { type: 'organization', organizationId: scope.organizationId }
            : {
                type: 'branch',
                organizationId: scope.organizationId,
                branchId: scope.branchId,
              },
        ),
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      throw new ServiceUnavailableException('Organization/branch scope validation is unavailable.');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('Organization/branch scope validation is unavailable.');
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        'Organization/branch scope validation returned invalid data.',
      );
    }

    const parsed = ownerResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ServiceUnavailableException(
        'Organization/branch scope validation returned invalid data.',
      );
    }
    if (!parsed.data.valid) return parsed.data;

    const matchesOrganization = sameUuid(parsed.data.organizationId, scope.organizationId);
    const matchesRequestedScope =
      scope.type === 'organization'
        ? parsed.data.branchId === undefined && parsed.data.branchVersion === undefined
        : parsed.data.branchId !== undefined &&
          parsed.data.branchVersion !== undefined &&
          sameUuid(parsed.data.branchId, scope.branchId);
    if (!matchesOrganization || !matchesRequestedScope) {
      throw new ServiceUnavailableException(
        'Organization/branch scope validation returned inconsistent data.',
      );
    }

    return parsed.data;
  }
}
