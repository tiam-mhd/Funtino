import type { OperationsAccessRole } from '../../lib/api/operations-staff';
import type { OperationsScope, OperationsScopeOption } from '../../lib/auth/operations-access';

const permissionLabels: Record<string, string> = {
  'organization.create': 'ایجاد مجموعه',
  'organization.read': 'مشاهده‌ی اطلاعات مجموعه',
  'organization.update': 'ویرایش اطلاعات مجموعه',
  'branch.create': 'ایجاد شعبه',
  'branch.read': 'مشاهده‌ی شعبه',
  'branch.update': 'ویرایش شعبه',
  'branch.deactivate': 'غیرفعال‌سازی شعبه',
  'staff.read': 'مشاهده‌ی کارکنان',
  'staff.invite': 'دعوت از کارکنان',
  'staff.suspend': 'تعلیق عضویت کارکنان',
  'staff.reactivate': 'فعال‌سازی دوباره‌ی عضویت کارکنان',
  'access.role.read': 'مشاهده‌ی نقش‌ها',
  'access.role.manage': 'مدیریت نقش‌ها',
  'access.permission.delegate': 'واگذاری دسترسی‌ها',
  'device.health.read': 'مشاهده‌ی وضعیت دستگاه‌ها',
  'device.register': 'ثبت دستگاه',
  'device.maintenance.manage': 'مدیریت تعمیر و نگهداری دستگاه‌ها',
  'card.inventory.read': 'مشاهده‌ی موجودی کارت‌ها',
  'card.inventory.manage': 'مدیریت موجودی کارت‌ها',
  'card.assign': 'تخصیص کارت',
  'card.transfer': 'انتقال کارت',
  'card.unassign': 'لغو تخصیص کارت',
  'customer.lookup.limited': 'جست‌وجوی محدود مشتری',
  'customer.family.read': 'مشاهده‌ی اطلاعات خانواده‌ی مشتری',
  'report.read': 'مشاهده‌ی گزارش‌ها',
  'report.export': 'دریافت خروجی گزارش‌ها',
  'audit.read': 'مشاهده‌ی سوابق مدیریتی',
  'system.access.bootstrap': 'راه‌اندازی دسترسی مدیر سامانه',
  'system.access.impersonate': 'ورود پشتیبانی با هویت کاربر',
  'system.health.read': 'مشاهده‌ی سلامت سامانه',
  'system.session_policy.manage': 'مدیریت سیاست نشست‌ها',
  'forms.platform.read': 'مشاهده‌ی تنظیمات سراسری فرم‌ها',
  'forms.platform.manage': 'مدیریت تنظیمات سراسری فرم‌ها',
  'forms.read': 'مشاهده‌ی فرم‌ها',
  'forms.manage': 'مدیریت فرم‌ها',
  'forms.publish': 'انتشار فرم‌ها',
  'forms.responses.read': 'مشاهده‌ی پاسخ‌ها',
  'forms.responses.manage': 'مدیریت پاسخ‌ها',
  'forms.responses.correct': 'اصلاح پاسخ‌ها',
  'forms.responses.pii.read': 'مشاهده‌ی اطلاعات حساس پاسخ‌ها',
  'forms.responses.export': 'دریافت خروجی پاسخ‌ها',
  'forms.templates.manage': 'مدیریت الگوهای فرم',
};

export function operationsRoleScopeLabel(
  scope: OperationsScope,
  options: OperationsScopeOption[],
): string {
  if (scope.type === 'organization') {
    const option = options.find(
      (candidate) =>
        candidate.scope.type === 'organization' &&
        sameId(candidate.scope.organizationId, scope.organizationId),
    );
    return `مجموعه ${option?.organization.name.trim() || 'بدون نام نمایشی'}`;
  }

  const option = options.find(
    (candidate) =>
      candidate.scope.type === 'branch' &&
      sameId(candidate.scope.organizationId, scope.organizationId) &&
      sameId(candidate.scope.branchId, scope.branchId),
  );
  return `شعبه ${option?.branch?.name.trim() || 'بدون نام نمایشی'}`;
}

export function operationsRolePermissionLabel(key: string, index: number): string {
  return (
    permissionLabels[key] ?? `دسترسی ثبت‌شده ${Math.max(1, index + 1).toLocaleString('fa-IR')}`
  );
}

export function groupOperationsRoles(
  roles: OperationsAccessRole[],
  activeScope: OperationsScope,
  options: OperationsScopeOption[],
): Array<{ key: string; heading: string | null; roles: OperationsAccessRole[] }> {
  if (activeScope.type === 'branch') {
    return [{ key: 'active-branch', heading: null, roles }];
  }

  const groups = new Map<
    string,
    { key: string; heading: string; order: number; roles: OperationsAccessRole[] }
  >();
  for (const role of roles) {
    const key =
      role.scope.type === 'organization'
        ? `organization:${role.scope.organizationId.toLowerCase()}`
        : `branch:${role.scope.organizationId.toLowerCase()}:${role.scope.branchId.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        heading:
          role.scope.type === 'organization'
            ? `نقش‌های ${operationsRoleScopeLabel(role.scope, options)}`
            : operationsRoleScopeLabel(role.scope, options),
        order: role.scope.type === 'organization' ? 0 : 1,
        roles: [],
      };
      groups.set(key, group);
    }
    group.roles.push(role);
  }

  return [...groups.values()]
    .sort(
      (left, right) => left.order - right.order || left.heading.localeCompare(right.heading, 'fa'),
    )
    .map(({ key, heading, roles: groupedRoles }) => ({
      key,
      heading,
      roles: groupedRoles,
    }));
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
