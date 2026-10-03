import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import {
  assertDeviceStatusTransition,
  deriveHealthState,
  normalizeAdapterKey,
  normalizeExternalDeviceId,
  type DeviceHealthPolicy,
  type DeviceRecord,
} from '../domain/device/device.js';
import {
  DEVICE_REGISTRY_REPOSITORY,
  type DeviceCommandMeta,
  type DeviceListQuery,
  type DeviceMutationResult,
  type DeviceRegistryRepository,
  type HealthObservationResult,
  type ImportTransactionCommand,
  type RegisterDeviceCommand,
  type ReportHealthCommand,
  type TransactionImportResult,
  type UpdateDeviceCommand,
} from './ports/device-registry.repository.js';
import {
  BRANCH_SCOPE_VALIDATOR,
  type BranchScopeValidator,
} from './ports/branch-scope-validator.port.js';

export type DeviceView = {
  id: string;
  organizationId: string;
  branchId: string;
  adapterKey: string;
  externalDeviceId: string;
  displayName: string;
  deviceType: DeviceRecord['deviceType'];
  status: DeviceRecord['status'];
  healthState: ReturnType<typeof deriveHealthState>;
  latestReportedState: DeviceRecord['latestReportedState'];
  latestObservedAt: string | null;
  freshnessSeconds: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type DeviceHealthPolicyProvider = () => DeviceHealthPolicy;
export const DEVICE_HEALTH_POLICY = Symbol('DEVICE_HEALTH_POLICY');

export type RegisterDeviceInput = Omit<RegisterDeviceCommand, 'organizationId' | 'branchId'>;
export type UpdateDeviceInput = Pick<UpdateDeviceCommand, 'displayName' | 'status' | 'reason'>;
export type HealthInput = Omit<ReportHealthCommand, 'observedAt' | 'correlationId'> & {
  observedAt: string;
};
export type TransactionEventInput = Omit<ImportTransactionCommand, 'occurredAt'> & {
  occurredAt: string;
};

@Injectable()
export class DeviceRegistryService {
  constructor(
    @Inject(DEVICE_REGISTRY_REPOSITORY) private readonly repository: DeviceRegistryRepository,
    @Inject(BRANCH_SCOPE_VALIDATOR) private readonly branchScope: BranchScopeValidator,
    @Inject(DEVICE_HEALTH_POLICY) private readonly healthPolicy: DeviceHealthPolicyProvider,
  ) {}

  async registerDevice(
    organizationId: string,
    branchId: string,
    input: RegisterDeviceInput,
    meta: DeviceCommandMeta,
  ): Promise<DeviceMutationResult> {
    const command: RegisterDeviceCommand = {
      ...input,
      organizationId,
      branchId,
      adapterKey: normalizeAdapterKey(input.adapterKey),
      externalDeviceId: normalizeExternalDeviceId(input.externalDeviceId),
    };
    const replay = await this.repository.findIdempotentMutation('device.register', command, meta);
    if (replay) return replay;
    await this.branchScope.assertActiveBranch(organizationId, branchId);
    return this.repository.registerDevice(command, meta);
  }

  async updateDevice(
    organizationId: string,
    branchId: string,
    deviceId: string,
    expectedVersion: number,
    input: UpdateDeviceInput,
    meta: DeviceCommandMeta,
  ): Promise<DeviceMutationResult> {
    if (input.displayName === undefined && input.status === undefined)
      throw new BadRequestException('At least one device field must be changed.');

    const command: UpdateDeviceCommand = {
      organizationId,
      branchId,
      deviceId,
      expectedVersion,
      ...input,
    };
    const replay = await this.repository.findIdempotentMutation('device.update', command, meta);
    if (replay) return replay;

    const current = await this.repository.getDevice(organizationId, deviceId, branchId);
    if (input.status !== undefined) {
      try {
        assertDeviceStatusTransition(current.status, input.status);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'DEVICE_STATUS_TRANSITION_INVALID';
        throw new ConflictException(reason);
      }
      if (current.version !== expectedVersion)
        throw new ConflictException('Device version is stale; reload before retrying.');
      if (input.status === 'active' && current.status !== 'active') {
        await this.branchScope.assertActiveBranch(current.organizationId, current.branchId);
      }
    }

    return this.repository.updateDevice(command, meta);
  }

  async listDevices(query: DeviceListQuery) {
    const page = await this.repository.listDevices(query);
    const now = new Date();
    return {
      items: page.items.map((device) => this.toView(device, now)),
      nextCursor: page.nextCursor,
    };
  }

  async getDevice(
    organizationId: string,
    deviceId: string,
    branchId?: string,
  ): Promise<DeviceView> {
    return this.toView(await this.repository.getDevice(organizationId, deviceId, branchId));
  }

  async reportHealth(input: HealthInput, correlationId: string): Promise<HealthObservationResult> {
    const observedAt = new Date(input.observedAt);
    if (observedAt.getTime() > Date.now() + 60_000)
      throw new BadRequestException('Device observation timestamp is in the future.');

    return this.repository.recordHealthObservation({
      ...input,
      adapterKey: normalizeAdapterKey(input.adapterKey),
      externalDeviceId: normalizeExternalDeviceId(input.externalDeviceId),
      observedAt,
      correlationId,
    });
  }

  async importTransactionEvent(
    input: TransactionEventInput,
    correlationId: string,
  ): Promise<TransactionImportResult> {
    const occurredAt = new Date(input.occurredAt);
    const command: ImportTransactionCommand = { ...input, occurredAt };
    const replay = await this.repository.findTransactionImportReplay(command);
    if (replay) return replay;
    if (Math.abs(Date.now() - occurredAt.getTime()) > 15 * 60 * 1000) {
      throw new DomainError('VALIDATION_ERROR', 'زمان رخداد دستگاه خارج از بازه‌ی مجاز است.');
    }
    return this.repository.importTransactionEvent(command, correlationId);
  }

  async isReady(): Promise<void> {
    await this.repository.isReady();
  }

  private toView(device: DeviceRecord, now = new Date()): DeviceView {
    const policy = this.healthPolicy();
    const age = device.latestObservedAt
      ? Math.max(0, Math.floor((now.getTime() - device.latestObservedAt.getTime()) / 1000))
      : null;
    return {
      id: device.id,
      organizationId: device.organizationId,
      branchId: device.branchId,
      adapterKey: device.adapterKey,
      externalDeviceId: device.externalDeviceId,
      displayName: device.displayName,
      deviceType: device.deviceType,
      status: device.status,
      healthState: deriveHealthState(
        device.latestReportedState,
        device.latestObservedAt,
        now,
        policy,
      ),
      latestReportedState: device.latestReportedState,
      latestObservedAt: device.latestObservedAt?.toISOString() ?? null,
      freshnessSeconds: age,
      version: device.version,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    };
  }
}
