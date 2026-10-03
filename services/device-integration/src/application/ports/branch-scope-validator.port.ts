export const BRANCH_SCOPE_VALIDATOR = Symbol('BRANCH_SCOPE_VALIDATOR');

export interface BranchScopeValidator {
  assertActiveBranch(organizationId: string, branchId: string): Promise<void>;
}
