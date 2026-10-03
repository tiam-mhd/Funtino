import type { AccessScope } from '../../domain/authorization/authorization-evaluator.js';

export const ORGANIZATION_SCOPE_OWNER = Symbol('ORGANIZATION_SCOPE_OWNER');

export type TenantAccessScope = Exclude<AccessScope, { type: 'global' }>;

export type OrganizationScopeValidation =
  | { valid: false; reason?: string }
  | {
      valid: true;
      organizationId: string;
      organizationVersion: number;
      branchId?: string;
      branchVersion?: number;
    };

export interface OrganizationScopeOwner {
  validateScope(scope: TenantAccessScope): Promise<OrganizationScopeValidation>;
}
