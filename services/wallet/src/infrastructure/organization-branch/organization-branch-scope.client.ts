import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { BranchScopeValidator } from '../../application/ports/branch-scope-validator.port.js';

@Injectable()
export class OrganizationBranchScopeClient implements BranchScopeValidator {
  async assertActiveBranch(organizationId: string, branchId: string): Promise<void> {
    const configuredUrl = process.env.WALLET_ORGANIZATION_BRANCH_INTERNAL_URL?.trim();
    const token = process.env.WALLET_ORGANIZATION_BRANCH_TOKEN;
    if (!configuredUrl || !token || token.length < 32 || token.length > 512) {
      throw new ServiceUnavailableException('Organization/branch validation is not configured.');
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
        (process.env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:')
      ) {
        throw new Error('invalid owner URL');
      }
      baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/internal/v1/scopes/validate`;
      endpoint = baseUrl.toString();
    } catch {
      throw new ServiceUnavailableException('Organization/branch validation is not configured.');
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-funtino-service-id': 'wallet',
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
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new ServiceUnavailableException(
        'Organization/branch validation returned invalid data.',
      );
    }
    const scope = result as { valid?: unknown; organizationId?: unknown; branchId?: unknown };
    if (typeof scope.valid !== 'boolean') {
      throw new ServiceUnavailableException(
        'Organization/branch validation returned invalid data.',
      );
    }
    if (
      scope.valid === false ||
      scope.organizationId !== organizationId ||
      scope.branchId !== branchId
    ) {
      throw new ConflictException('An active branch in the selected organization is required.');
    }
  }
}
