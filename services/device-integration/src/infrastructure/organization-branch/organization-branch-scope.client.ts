import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import type { BranchScopeValidator } from '../../application/ports/branch-scope-validator.port.js';

@Injectable()
export class OrganizationBranchScopeClient implements BranchScopeValidator {
  async assertActiveBranch(organizationId: string, branchId: string): Promise<void> {
    const baseUrl = process.env.ORGANIZATION_BRANCH_INTERNAL_URL?.replace(/\/$/, '');
    const token = process.env.DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512)
      throw new ServiceUnavailableException('Organization/branch validation is not configured.');

    try {
      const parsed = new URL(baseUrl);
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash ||
        (process.env.NODE_ENV === 'production' &&
          parsed.protocol !== 'https:' &&
          !isRunflareClusterIpServiceBaseUrl(parsed))
      ) {
        throw new Error('Invalid Organization & Branch URL.');
      }
    } catch {
      throw new ServiceUnavailableException('Organization/branch validation is not configured.');
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/internal/v1/scopes/validate`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-funtino-service-id': 'device-integration',
          'x-funtino-service-token': token,
        },
        body: JSON.stringify({ type: 'branch', organizationId, branchId }),
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      throw new ServiceUnavailableException('Organization/branch validation is unavailable.');
    }
    if (!response.ok)
      throw new ServiceUnavailableException('Organization/branch validation is unavailable.');

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        'Organization/branch validation returned invalid data.',
      );
    }
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new ServiceUnavailableException(
        'Organization/branch validation returned invalid data.',
      );
    const scope = result as { valid?: unknown; organizationId?: unknown; branchId?: unknown };
    if (typeof scope.valid !== 'boolean')
      throw new ServiceUnavailableException(
        'Organization/branch validation returned invalid data.',
      );
    if (
      scope.valid === false ||
      scope.organizationId !== organizationId ||
      scope.branchId !== branchId
    ) {
      throw new ConflictException('An active branch in the selected organization is required.');
    }
  }
}
