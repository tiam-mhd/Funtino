import type {
  CustomerBranchSummary,
  CustomerCard,
  CustomerHouseholdSummary,
} from './customer-api.js';

export type CustomerCardLookupAvailability = {
  households: boolean;
  branches: boolean;
};

export type CustomerCardRelations = {
  householdName: string;
  branchName: string;
  branchStatus: 'فعال' | 'غیرفعال' | null;
};

export function resolveCustomerCardRelations(
  card: CustomerCard,
  households: CustomerHouseholdSummary[],
  branches: CustomerBranchSummary[],
  availability: CustomerCardLookupAvailability,
): CustomerCardRelations {
  const household = households.find((item) => item.id === card.householdId);
  const branch = card.branchId
    ? branches.find((item) => item.id === card.branchId && item.name.trim().length > 0)
    : undefined;

  return {
    householdName: !availability.households
      ? 'نام خانواده فعلاً در دسترس نیست'
      : (household?.name ?? 'خانواده در فهرست معتبر پیدا نشد'),
    branchName: !card.branchId
      ? 'شعبه برای این کارت ثبت نشده'
      : !availability.branches
        ? 'اطلاعات شعبه فعلاً در دسترس نیست'
        : (branch?.name ?? 'شعبه در فهرست معتبر پیدا نشد'),
    branchStatus: branch ? (branch.status === 'open' ? 'فعال' : 'غیرفعال') : null,
  };
}

export function customerCardFreshnessLabel(card: CustomerCard): string {
  if (card.freshness === 'unknown') return 'وضعیت دستگاه هنوز گزارش نشده';
  if (!card.lastSyncedAt || !Number.isFinite(Date.parse(card.lastSyncedAt))) {
    return 'زمان آخرین وضعیت معتبر نیست';
  }
  return card.freshness === 'stale' ? 'آخرین وضعیت قدیمی است' : 'آخرین وضعیت به‌روز است';
}
