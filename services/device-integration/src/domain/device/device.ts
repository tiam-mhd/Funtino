export const deviceTypes = ['rfid_reader', 'terminal', 'access_gate', 'other'] as const;
export type DeviceType = (typeof deviceTypes)[number];

export const deviceStatuses = ['active', 'suspended', 'retired'] as const;
export type DeviceStatus = (typeof deviceStatuses)[number];

export const reportedHealthStates = ['online', 'degraded', 'offline'] as const;
export type ReportedHealthState = (typeof reportedHealthStates)[number];
export type DeviceHealthState = 'unknown' | 'online' | 'degraded' | 'stale' | 'offline';

export type DeviceRecord = {
  id: string;
  organizationId: string;
  branchId: string;
  adapterKey: string;
  externalDeviceId: string;
  displayName: string;
  deviceType: DeviceType;
  status: DeviceStatus;
  latestReportedState: ReportedHealthState | null;
  latestObservedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DeviceHealthPolicy = {
  staleAfterSeconds: number;
  offlineAfterSeconds: number;
};

export function deriveHealthState(
  reportedState: ReportedHealthState | null,
  observedAt: Date | null,
  now: Date,
  policy: DeviceHealthPolicy,
): DeviceHealthState {
  if (!reportedState || !observedAt) return 'unknown';
  if (reportedState === 'offline') return 'offline';

  const ageSeconds = Math.max(0, (now.getTime() - observedAt.getTime()) / 1000);
  if (ageSeconds >= policy.offlineAfterSeconds) return 'offline';
  if (ageSeconds >= policy.staleAfterSeconds) return 'stale';
  return reportedState;
}

export function assertDeviceStatusTransition(current: DeviceStatus, next: DeviceStatus): void {
  if (current === next) return;
  if (current === 'retired') throw new Error('DEVICE_RETIRED_IS_TERMINAL');
  if (next === 'active' && current !== 'suspended')
    throw new Error('DEVICE_STATUS_TRANSITION_INVALID');
}

export function normalizeAdapterKey(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeExternalDeviceId(value: string): string {
  return value.trim();
}
