import { apiRequest } from './client';
import type { OperationsScope } from '../auth/operations-access';

export type OperationsFamilyResult = {
  householdId: string;
  householdName: string;
  members: Array<{
    id: string;
    displayName: string;
    relationshipLabel: string;
    relationshipStatus: 'verified' | 'ambiguous' | 'needs_review';
    legacyRelationship: string | null;
    isAccountLinked: boolean;
    isDependent: boolean;
    status: 'active' | 'archived';
  }>;
  invitations: Array<{
    memberName: string;
    status:
      | 'pending'
      | 'accepted'
      | 'declined'
      | 'revoked'
      | 'expired'
      | 'claim_pending'
      | 'linked'
      | 'conflict_review';
  }>;
  relationships: Array<{
    fromMemberId: string;
    toMemberId: string;
    kind: 'parent_of' | 'spouse_of' | 'sibling_of' | 'guardian_of';
    basis: 'biological' | 'legal' | 'adoptive' | 'step' | 'partner' | 'unspecified';
  }>;
  history: Array<{ action: string; createdAt: string }>;
};

export function lookupOperationsCustomerFamily(input: {
  scope: OperationsScope;
  branchId: string;
  phone: string;
}) {
  return apiRequest<{ items: OperationsFamilyResult[] }>(
    '/api/v1/operations/customer-family/lookup',
    {
      method: 'POST',
      body: {
        organizationId: input.scope.organizationId,
        branchId: input.branchId,
        phone: input.phone,
      },
    },
  );
}
