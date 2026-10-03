export const CARD_INVENTORY_STATUSES = ['in_stock', 'assigned', 'blocked', 'retired'] as const;
export type CardInventoryStatus = (typeof CARD_INVENTORY_STATUSES)[number];
export const CARD_MANUAL_STATUS_TARGETS = ['in_stock', 'blocked', 'retired'] as const;
export type CardManualStatusTarget = (typeof CARD_MANUAL_STATUS_TARGETS)[number];

export const CARD_VERIFICATION_STATUSES = ['unknown', 'verified', 'rejected'] as const;
export type CardVerificationStatus = (typeof CARD_VERIFICATION_STATUSES)[number];

export type CardInventoryRecord = {
  id: string;
  organizationId: string;
  branchId: string;
  externalCardId: string;
  status: CardInventoryStatus;
  verificationStatus: CardVerificationStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CardInventoryView = Omit<
  CardInventoryRecord,
  'externalCardId' | 'createdAt' | 'updatedAt'
> & {
  maskedIdentifier: string;
  createdAt: string;
  updatedAt: string;
};

export type CardAssignmentView = {
  id: string;
  cardId: string;
  organizationId: string;
  branchId: string;
  householdId: string;
  maskedIdentifier: string;
  status: CardInventoryStatus;
  verificationStatus: CardVerificationStatus;
  assignedAt: string;
};

export function normalizeExternalCardId(value: string): string {
  const normalized = value.trim().normalize('NFC');
  if (
    normalized.length < 1 ||
    normalized.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error('CARD_IDENTIFIER_INVALID');
  }
  return normalized;
}

export function maskExternalCardId(value: string): string {
  if (value.length <= 4) return '••••';
  return `•••• ${value.slice(-4)}`;
}

export function isCardStatusTransitionAllowed(
  current: CardInventoryStatus,
  next: CardInventoryStatus,
): boolean {
  if (current === next) return true;
  if (current === 'retired') return false;
  if (current === 'in_stock') return next === 'blocked' || next === 'retired';
  if (current === 'assigned') return next === 'blocked' || next === 'retired';
  return next === 'in_stock' || next === 'retired';
}

export function toCardInventoryView(record: CardInventoryRecord): CardInventoryView {
  return {
    id: record.id,
    organizationId: record.organizationId,
    branchId: record.branchId,
    maskedIdentifier: maskExternalCardId(record.externalCardId),
    status: record.status,
    verificationStatus: record.verificationStatus,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function cardAuditSnapshot(
  record: Pick<
    CardInventoryRecord,
    'id' | 'organizationId' | 'branchId' | 'status' | 'verificationStatus' | 'version'
  >,
) {
  return {
    cardId: record.id,
    organizationId: record.organizationId,
    branchId: record.branchId,
    status: record.status,
    verificationStatus: record.verificationStatus,
    version: record.version,
  };
}
