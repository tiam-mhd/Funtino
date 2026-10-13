export const permissionCatalogVersion = 5;

export const permissionCatalog = [
  { key: 'organization.create', scopes: ['global'], delegable: false, stepUp: true },
  { key: 'organization.read', scopes: ['organization', 'global'], delegable: true, stepUp: false },
  { key: 'organization.update', scopes: ['organization', 'global'], delegable: true, stepUp: true },
  { key: 'branch.create', scopes: ['organization', 'global'], delegable: true, stepUp: true },
  {
    key: 'branch.read',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: false,
  },
  {
    key: 'branch.update',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'branch.deactivate',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'staff.read',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: false,
  },
  {
    key: 'staff.invite',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'staff.suspend',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'staff.reactivate',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'access.role.read',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: false,
  },
  {
    key: 'access.role.manage',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'access.permission.delegate',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'device.health.read',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: false,
  },
  {
    key: 'device.register',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'device.maintenance.manage',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'card.inventory.read',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: false,
  },
  {
    key: 'card.inventory.manage',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'card.assign',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'card.transfer',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'card.unassign',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'customer.lookup.limited',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'customer.family.read',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'report.read',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: false,
  },
  {
    key: 'report.export',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'audit.read',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
  { key: 'system.access.bootstrap', scopes: ['global'], delegable: false, stepUp: true },
  { key: 'system.access.impersonate', scopes: ['global'], delegable: false, stepUp: true },
  { key: 'system.health.read', scopes: ['global'], delegable: true, stepUp: false },
  { key: 'system.session_policy.manage', scopes: ['global'], delegable: false, stepUp: false },
  { key: 'forms.platform.read', scopes: ['global'], delegable: true, stepUp: false },
  { key: 'forms.platform.manage', scopes: ['global'], delegable: false, stepUp: true },
  { key: 'forms.read', scopes: ['branch', 'organization'], delegable: true, stepUp: false },
  { key: 'forms.manage', scopes: ['branch', 'organization'], delegable: true, stepUp: false },
  { key: 'forms.publish', scopes: ['branch', 'organization'], delegable: true, stepUp: true },
  {
    key: 'forms.responses.read',
    scopes: ['branch', 'organization'],
    delegable: true,
    stepUp: false,
  },
  {
    key: 'forms.responses.manage',
    scopes: ['branch', 'organization'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'forms.responses.correct',
    scopes: ['branch', 'organization'],
    delegable: true,
    stepUp: false,
  },
  {
    key: 'forms.responses.pii.read',
    scopes: ['branch', 'organization'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'forms.responses.export',
    scopes: ['branch', 'organization'],
    delegable: true,
    stepUp: true,
  },
  {
    key: 'forms.templates.manage',
    scopes: ['branch', 'organization', 'global'],
    delegable: true,
    stepUp: true,
  },
] as const;

export type PermissionKey = (typeof permissionCatalog)[number]['key'];
export type ScopeType = 'global' | 'organization' | 'branch';
export type PermissionDefinition = {
  key: PermissionKey;
  scopes: readonly ScopeType[];
  delegable: boolean;
  stepUp: boolean;
};

const definitionsByKey = new Map<string, PermissionDefinition>(
  permissionCatalog.map((permission) => [permission.key, permission]),
);

export function getPermissionDefinition(key: string): PermissionDefinition | undefined {
  return definitionsByKey.get(key);
}

export function isPermissionKey(value: string): value is PermissionKey {
  return definitionsByKey.has(value);
}
