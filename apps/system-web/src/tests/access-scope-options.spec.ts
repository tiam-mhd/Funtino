import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeScopeOptions,
  loadAllScopeOptions,
  resolveSelectedScope,
  type ScopeBranchOption,
  type ScopeOrganizationOption,
} from '../features/access-control/scope-options.js';

const organizations: ScopeOrganizationOption[] = [
  { id: 'org-active', name: 'فانتینو', slug: 'funtino', status: 'active' },
  { id: 'org-suspended', name: 'مجموعه غیرفعال', slug: 'inactive', status: 'suspended' },
];

const branches: ScopeBranchOption[] = [
  {
    id: 'branch-active',
    organizationId: 'org-active',
    name: 'پرند',
    slug: 'parand',
    city: 'پرند',
    status: 'active',
  },
  {
    id: 'branch-other-org',
    organizationId: 'org-suspended',
    name: 'شعبه دیگر',
    slug: 'other',
    city: 'تهران',
    status: 'active',
  },
  {
    id: 'branch-suspended',
    organizationId: 'org-active',
    name: 'شعبه معلق',
    slug: 'paused',
    city: 'پرند',
    status: 'suspended',
  },
];

test('loads every page while advancing the cursor', async () => {
  const requestedCursors: Array<string | undefined> = [];
  const items = await loadAllScopeOptions<{ id: string }>(async (cursor, pageSize) => {
    requestedCursors.push(cursor);
    assert.equal(pageSize, 100);
    return cursor
      ? { items: [{ id: 'second' }], nextCursor: null }
      : { items: [{ id: 'first' }], nextCursor: 'cursor-1' };
  });

  assert.deepEqual(items, [{ id: 'first' }, { id: 'second' }]);
  assert.deepEqual(requestedCursors, [undefined, 'cursor-1']);
});

test('rejects pagination that does not advance', async () => {
  await assert.rejects(
    loadAllScopeOptions(async (cursor) => ({
      items: [],
      nextCursor: cursor ? 'cursor-1' : 'cursor-1',
    })),
    /cursor did not advance/,
  );
});

test('only active resources are selectable', () => {
  assert.deepEqual(
    activeScopeOptions(organizations).map((item) => item.id),
    ['org-active'],
  );
  assert.deepEqual(
    activeScopeOptions(branches).map((item) => item.id),
    ['branch-active', 'branch-other-org'],
  );
});

test('accepts organization scope and a branch only under its selected active organization', () => {
  assert.deepEqual(
    resolveSelectedScope('organization', 'org-active', '', organizations, branches),
    { type: 'organization', organizationId: 'org-active' },
  );
  assert.deepEqual(
    resolveSelectedScope('branch', 'org-active', 'branch-active', organizations, branches),
    { type: 'branch', organizationId: 'org-active', branchId: 'branch-active' },
  );
  assert.equal(
    resolveSelectedScope('organization', 'org-suspended', '', organizations, branches),
    null,
  );
  assert.equal(
    resolveSelectedScope('branch', 'org-active', 'branch-other-org', organizations, branches),
    null,
  );
  assert.equal(
    resolveSelectedScope('branch', 'org-active', 'branch-suspended', organizations, branches),
    null,
  );
});
