import { apiRequest } from './client';

type Page<T> = { items: T[]; nextCursor: string | null };
export type SystemOrganizationOption = {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'archived';
};
export type SystemBranchOption = {
  id: string;
  organizationId: string;
  name: string;
  status: 'active' | 'suspended' | 'archived';
};
export type SystemFamilyResult = {
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

export async function getSystemOrganizations(): Promise<SystemOrganizationOption[]> {
  return listAll<SystemOrganizationOption>('/api/v1/system/organizations');
}

export async function getSystemOrganizationBranches(
  organizationId: string,
): Promise<SystemBranchOption[]> {
  return listAll<SystemBranchOption>(
    `/api/v1/system/organizations/${encodeURIComponent(organizationId)}/branches`,
  );
}

export function lookupSystemCustomerFamily(input: {
  organizationId: string;
  branchId: string;
  phone: string;
}) {
  return apiRequest<{ items: SystemFamilyResult[] }>('/api/v1/system/customer-family/lookup', {
    method: 'POST',
    body: input,
  });
}

async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const query = new URLSearchParams({ pageSize: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await apiRequest<Page<T>>(`${path}?${query.toString()}`);
    items.push(...page.items);
    if (!page.nextCursor) return items;
    if (seen.has(page.nextCursor)) throw new Error('پاسخ فهرست مجموعه یا شعبه ناسازگار است.');
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error('فهرست بیش از حد طولانی است؛ از فیلترهای دقیق‌تر استفاده کن.');
}
