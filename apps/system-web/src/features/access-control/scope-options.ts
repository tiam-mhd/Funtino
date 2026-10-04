export type Scope =
  | { type: 'global' }
  | { type: 'organization'; organizationId: string }
  | { type: 'branch'; organizationId: string; branchId: string };

export type ScopeOrganizationOption = {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'archived';
};

export type ScopeBranchOption = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  city: string;
  status: 'active' | 'suspended' | 'archived';
};

export type ScopeOptionPage<T> = { items: T[]; nextCursor: string | null };

export function activeScopeOptions<T extends { status: string }>(items: readonly T[]): T[] {
  return items.filter((item) => item.status === 'active');
}

export async function loadAllScopeOptions<T>(
  loadPage: (cursor: string | undefined, pageSize: number) => Promise<ScopeOptionPage<T>>,
  pageSize = 100,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new RangeError('Scope list page size must be between 1 and 100.');
  }

  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
    const page = await loadPage(cursor, pageSize);
    if (
      !page ||
      !Array.isArray(page.items) ||
      !(page.nextCursor === null || typeof page.nextCursor === 'string')
    ) {
      throw new Error('The scope list returned an invalid page.');
    }
    items.push(...page.items);

    if (page.nextCursor === null) return items;
    if (!page.nextCursor.trim() || seenCursors.has(page.nextCursor)) {
      throw new Error('The scope list pagination cursor did not advance.');
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  throw new Error('The scope list contains too many pages.');
}

export function resolveSelectedScope(
  scopeType: Scope['type'],
  organizationId: string,
  branchId: string,
  organizations: readonly ScopeOrganizationOption[],
  branches: readonly ScopeBranchOption[],
): Scope | null {
  if (scopeType === 'global') return { type: 'global' };

  const organization = organizations.find(
    (item) => item.id === organizationId && item.status === 'active',
  );
  if (!organization) return null;
  if (scopeType === 'organization') {
    return { type: 'organization', organizationId: organization.id };
  }

  const branch = branches.find(
    (item) =>
      item.id === branchId && item.organizationId === organization.id && item.status === 'active',
  );
  return branch ? { type: 'branch', organizationId: organization.id, branchId: branch.id } : null;
}
