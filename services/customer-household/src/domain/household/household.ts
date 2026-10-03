export const HOUSEHOLD_STATUSES = ['active', 'suspended', 'archived'] as const;
export type HouseholdStatus = (typeof HOUSEHOLD_STATUSES)[number];

export function isHouseholdEligibleForCard(status: HouseholdStatus): boolean {
  return status === 'active';
}

export function normalizeHouseholdName(value: string): string {
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error('HOUSEHOLD_NAME_INVALID');
  const normalized = value.trim().normalize('NFC').replace(/\s+/gu, ' ');
  if (normalized.length < 2 || normalized.length > 80) {
    throw new Error('HOUSEHOLD_NAME_INVALID');
  }
  return normalized;
}

export function normalizeMemberText(value: string, maxLength: number): string {
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error('HOUSEHOLD_MEMBER_TEXT_INVALID');
  const normalized = value.trim().normalize('NFC').replace(/\s+/gu, ' ');
  if (normalized.length < 2 || normalized.length > maxLength) {
    throw new Error('HOUSEHOLD_MEMBER_TEXT_INVALID');
  }
  return normalized;
}
