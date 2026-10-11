import type { PermissionKey, ScopeType } from './permission-catalog.js';

export type AccessRoleTemplate = {
  key: string;
  name: string;
  scopeType: Exclude<ScopeType, 'global'> | 'global';
  permissionKeys: readonly PermissionKey[];
};

/** Versioned, least-privilege starting points. Tenants may add custom roles, never new keys. */
export const accessRoleTemplates: readonly AccessRoleTemplate[] = [
  {
    key: 'system_support',
    name: 'پشتیبانی فقط‌خواندنی',
    scopeType: 'global',
    permissionKeys: [
      'organization.read',
      'branch.read',
      'staff.read',
      'access.role.read',
      'device.health.read',
      'card.inventory.read',
      'report.read',
      'audit.read',
      'system.health.read',
    ],
  },
  {
    key: 'organization_manager',
    name: 'مدیر مجموعه',
    scopeType: 'organization',
    permissionKeys: [
      'organization.read',
      'organization.update',
      'branch.create',
      'branch.read',
      'branch.update',
      'branch.deactivate',
      'staff.read',
      'staff.invite',
      'staff.suspend',
      'staff.reactivate',
      'access.role.read',
      'access.role.manage',
      'access.permission.delegate',
      'device.health.read',
      'device.register',
      'device.maintenance.manage',
      'card.inventory.read',
      'card.inventory.manage',
      'card.assign',
      'card.transfer',
      'card.unassign',
      'customer.lookup.limited',
      'report.read',
      'report.export',
      'audit.read',
      'forms.read',
      'forms.manage',
      'forms.publish',
      'forms.responses.read',
      'forms.responses.manage',
      'forms.responses.correct',
      'forms.responses.export',
      'forms.templates.manage',
    ],
  },
  {
    key: 'organization_crm_manager',
    name: 'مدیر ارتباط با مشتریان مجموعه',
    scopeType: 'organization',
    permissionKeys: ['staff.read', 'customer.lookup.limited', 'report.read', 'report.export', 'forms.read', 'forms.responses.read'],
  },
  {
    key: 'organization_support',
    name: 'پشتیبانی مجموعه',
    scopeType: 'organization',
    permissionKeys: ['organization.read', 'branch.read', 'staff.read', 'device.health.read'],
  },
  {
    key: 'branch_manager',
    name: 'مدیر شعبه',
    scopeType: 'branch',
    permissionKeys: [
      'branch.read',
      'branch.update',
      'staff.read',
      'staff.invite',
      'staff.suspend',
      'staff.reactivate',
      'access.role.read',
      'access.role.manage',
      'access.permission.delegate',
      'device.health.read',
      'device.register',
      'device.maintenance.manage',
      'card.inventory.read',
      'card.inventory.manage',
      'card.assign',
      'card.transfer',
      'card.unassign',
      'customer.lookup.limited',
      'report.read',
      'report.export',
      'audit.read',
      'forms.read',
      'forms.manage',
      'forms.publish',
      'forms.responses.read',
      'forms.responses.manage',
      'forms.responses.correct',
      'forms.responses.export',
      'forms.templates.manage',
    ],
  },
  {
    key: 'branch_cashier',
    name: 'صندوق‌دار شعبه',
    scopeType: 'branch',
    permissionKeys: [
      'card.inventory.read',
      'card.assign',
      'card.transfer',
      'customer.lookup.limited',
    ],
  },
  {
    key: 'branch_operator',
    name: 'اپراتور دستگاه شعبه',
    scopeType: 'branch',
    permissionKeys: ['branch.read', 'device.health.read', 'device.maintenance.manage'],
  },
  {
    key: 'branch_crm_manager',
    name: 'مدیر ارتباط با مشتریان شعبه',
    scopeType: 'branch',
    permissionKeys: ['staff.read', 'customer.lookup.limited', 'report.read', 'forms.read', 'forms.responses.read'],
  },
  {
    key: 'branch_support',
    name: 'پشتیبانی شعبه',
    scopeType: 'branch',
    permissionKeys: ['branch.read', 'staff.read', 'device.health.read', 'card.inventory.read'],
  },
];

export function templatesForScope(scopeType: ScopeType): readonly AccessRoleTemplate[] {
  return accessRoleTemplates.filter((template) => template.scopeType === scopeType);
}
