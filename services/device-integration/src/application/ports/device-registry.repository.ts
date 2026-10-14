import type {
  DeviceRecord,
  DeviceStatus,
  DeviceType,
  ReportedHealthState,
} from '../../domain/device/device.js';

export type DeviceCommandMeta = {
  callerService: 'api-gateway';
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
};

export type RegisterDeviceCommand = {
  organizationId: string;
  branchId: string;
  adapterKey: string;
  externalDeviceId: string;
  displayName: string;
  deviceType: DeviceType;
  reason?: string;
};

export type UpdateDeviceCommand = {
  organizationId: string;
  branchId: string;
  deviceId: string;
  expectedVersion: number;
  displayName?: string;
  status?: DeviceStatus;
  reason?: string;
};

export type ReportHealthCommand = {
  organizationId: string;
  adapterKey: string;
  externalDeviceId: string;
  externalObservationId: string;
  reportedState: ReportedHealthState;
  observedAt: Date;
  correlationId: string;
};

export type ImportTransactionCommand = {
  externalEventId: string;
  organizationId: string;
  branchId: string;
  externalCardId: string;
  transactionKind: 'top_up' | 'spend' | 'refund' | 'adjustment';
  amountMinor: number;
  currency: string;
  occurredAt: Date;
};

export type DeviceListQuery = {
  organizationId: string;
  branchId?: string;
  status?: DeviceStatus;
  cursor?: string;
  pageSize: number;
};

export type DeviceListResult = {
  items: DeviceRecord[];
  nextCursor: string | null;
};

export type DeviceMutationResult = {
  deviceId: string;
  status: DeviceStatus;
  version: number;
};

export type HealthObservationResult = {
  accepted: true;
  duplicate: boolean;
  deviceId: string;
  observationId: string;
  observedAt: string;
  isLatest: boolean;
};

export type TransactionImportResult = {
  accepted: true;
  duplicate: boolean;
  externalEventId: string;
  transactionId: string;
};

export const DEVICE_REGISTRY_REPOSITORY = Symbol('DEVICE_REGISTRY_REPOSITORY');

export interface DeviceRegistryRepository {
  findIdempotentMutation(
    operation: 'device.register' | 'device.update',
    command: RegisterDeviceCommand | UpdateDeviceCommand,
    meta: DeviceCommandMeta,
  ): Promise<DeviceMutationResult | null>;
  registerDevice(
    command: RegisterDeviceCommand,
    meta: DeviceCommandMeta,
  ): Promise<DeviceMutationResult>;
  updateDevice(
    command: UpdateDeviceCommand,
    meta: DeviceCommandMeta,
  ): Promise<DeviceMutationResult>;
  listDevices(query: DeviceListQuery): Promise<DeviceListResult>;
  getDevice(organizationId: string, deviceId: string, branchId?: string): Promise<DeviceRecord>;
  recordHealthObservation(command: ReportHealthCommand): Promise<HealthObservationResult>;
  findTransactionImportReplay(
    command: ImportTransactionCommand,
  ): Promise<TransactionImportResult | null>;
  importTransactionEvent(
    command: ImportTransactionCommand,
    correlationId: string,
  ): Promise<TransactionImportResult>;
  isReady(): Promise<void>;
}
