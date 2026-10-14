import { apiRequest, apiRequestPage } from './client';
import type { OperationsScope } from '../auth/operations-access';

export type OperationsDevice = {
  id: string;
  organizationId: string;
  branchId: string;
  adapterKey: string;
  externalDeviceId: string;
  displayName: string;
  deviceType: 'rfid_reader' | 'terminal' | 'access_gate' | 'other';
  status: 'active' | 'suspended' | 'retired';
  healthState: 'unknown' | 'online' | 'degraded' | 'stale' | 'offline';
  latestReportedState: 'online' | 'degraded' | 'offline' | null;
  latestObservedAt: string | null;
  freshnessSeconds: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OperationsBranch = {
  id: string;
  organizationId: string;
  name: string;
  city: string;
};
export type OperationsDeviceBranch = OperationsBranch;

export type OperationsDeviceCapabilities = {
  canRegister: boolean;
  canManage: boolean;
  canReadBranches: boolean;
};

export type OperationsDevicePage = {
  data: OperationsDevice[];
  nextCursor: string | null;
};

export type OperationsDeviceBranchPage = {
  data: OperationsBranch[];
  nextCursor: string | null;
};

function scopedQuery(scope: OperationsScope, cursor?: string, status?: OperationsDevice['status']) {
  const query = new URLSearchParams({
    scopeType: scope.type,
    organizationId: scope.organizationId,
    pageSize: '100',
  });
  if (scope.type === 'branch') query.set('branchId', scope.branchId);
  if (cursor) query.set('cursor', cursor);
  if (status) query.set('status', status);
  return query;
}

export async function listOperationsDevices(
  scope: OperationsScope,
  cursor?: string,
  status?: OperationsDevice['status'],
): Promise<{
  data: OperationsDevice[];
  nextCursor: string | null;
  capabilities: OperationsDeviceCapabilities;
}> {
  const page = await apiRequestPage<{
    items: OperationsDevice[];
    capabilities: OperationsDeviceCapabilities;
  }>(`/api/v1/operations/devices?${scopedQuery(scope, cursor, status)}`);
  return {
    data: page.data.items,
    nextCursor: page.nextCursor,
    capabilities: page.data.capabilities,
  };
}

export async function listOperationsBranches(
  organizationId: string,
  cursor?: string,
): Promise<OperationsDeviceBranchPage> {
  const query = new URLSearchParams({ pageSize: '100' });
  if (cursor) query.set('cursor', cursor);
  const page = await apiRequestPage<{ items: OperationsBranch[] }>(
    `/api/v1/operations/organizations/${encodeURIComponent(organizationId)}/branches?${query}`,
  );
  return { data: page.data.items, nextCursor: page.nextCursor };
}

export const listOperationsDeviceBranches = listOperationsBranches;

export type DeviceRegistration = {
  adapterKey: string;
  externalDeviceId: string;
  displayName: string;
  deviceType: OperationsDevice['deviceType'];
  reason?: string;
};

export async function registerOperationsDevice(
  organizationId: string,
  branchId: string,
  input: DeviceRegistration,
  idempotencyKey: string,
) {
  return apiRequest<{ deviceId: string; status: OperationsDevice['status']; version: number }>(
    `/api/v1/operations/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/devices`,
    { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export async function updateOperationsDevice(
  device: OperationsDevice,
  input: { displayName?: string; status?: OperationsDevice['status']; reason?: string },
  idempotencyKey: string,
) {
  return apiRequest<{ deviceId: string; status: OperationsDevice['status']; version: number }>(
    `/api/v1/operations/organizations/${encodeURIComponent(device.organizationId)}/branches/${encodeURIComponent(device.branchId)}/devices/${encodeURIComponent(device.id)}`,
    {
      method: 'PATCH',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey, 'If-Match': `"${device.version}"` },
    },
  );
}
