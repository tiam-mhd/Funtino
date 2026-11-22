import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitEventBus } from '@funtino/backend-core';
import {
  DEVICE_HEALTH_POLICY,
  DeviceRegistryService,
} from './application/device-registry.service.js';
import { EdgeSnapshotService } from './application/edge-snapshot.service.js';
import { EdgeSyncOperationsService } from './application/edge-sync-operations.service.js';
import { EdgeOperatorPairingService } from './application/edge-operator-pairing.service.js';
import type { DeviceHealthPolicy } from './domain/device/device.js';
import { BRANCH_SCOPE_VALIDATOR } from './application/ports/branch-scope-validator.port.js';
import { DEVICE_REGISTRY_REPOSITORY } from './application/ports/device-registry.repository.js';
import { DEVICE_SIGNATURE_VERIFIER } from './application/ports/device-signature-verifier.port.js';
import { EDGE_OPERATOR_PAIRING_REPOSITORY } from './application/ports/edge-operator-pairing.repository.js';
import {
  DeviceOutboxRelayService,
  DEVICE_EVENT_BUS,
  DEVICE_RABBIT_URL,
} from './infrastructure/messaging/outbox/device-outbox-relay.service.js';
import { PrismaDeviceRegistryRepository } from './infrastructure/persistence/prisma/prisma-device-registry.repository.js';
import { PrismaEdgeOperatorPairingRepository } from './infrastructure/persistence/prisma/prisma-edge-operator-pairing.repository.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { OrganizationBranchScopeClient } from './infrastructure/organization-branch/organization-branch-scope.client.js';
import { WalletEdgeMappingClient } from './infrastructure/wallet/wallet-edge-mapping.client.js';
import { EdgeCardOperationsClient } from './infrastructure/wallet/edge-card-operations.client.js';
import { PricingSnapshotClient } from './infrastructure/pricing/pricing-snapshot.client.js';
import { EdgeOperatorTokenClient } from './infrastructure/identity-access/edge-operator-token.client.js';
import { EdgeProvisionalCustomerClient } from './infrastructure/customer-household/edge-provisional-customer.client.js';
import { EdgeHouseholdOperationsClient } from './infrastructure/customer-household/edge-household-operations.client.js';
import { EdgeIdentityLookupClient } from './infrastructure/gateway/edge-identity-lookup.client.js';
import { EdgeOperatorPairingGatewayClient } from './infrastructure/gateway/edge-operator-pairing.client.js';
import { HmacDeviceSignatureService } from './infrastructure/security/hmac-device-signature.service.js';
import { DeviceController, DeviceWebhookController } from './interfaces/http/device.controller.js';
import { EdgeController } from './interfaces/http/edge.controller.js';
import { EdgeCustomerOperationsController } from './interfaces/http/edge-customer-operations.controller.js';
import { EdgeInstallationController } from './interfaces/http/edge-installation.controller.js';
import { EdgeSnapshotController } from './interfaces/http/edge-snapshot.controller.js';
import { EdgeSyncOperationsController } from './interfaces/http/edge-sync-operations.controller.js';
import { EdgeOperatorPairingController } from './interfaces/http/edge-operator-pairing.controller.js';
import { EdgeOperatorPairingApprovalController } from './interfaces/http/edge-operator-pairing-approval.controller.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { DeviceIntegrationServiceTokenGuard } from './interfaces/http/service-token.guard.js';

function positiveSeconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function configuredHealthPolicy(): DeviceHealthPolicy {
  const staleAfterSeconds = positiveSeconds('DEVICE_HEALTH_STALE_AFTER_SECONDS', 300);
  const offlineAfterSeconds = positiveSeconds('DEVICE_HEALTH_OFFLINE_AFTER_SECONDS', 900);
  if (offlineAfterSeconds <= staleAfterSeconds)
    throw new Error('DEVICE_HEALTH_OFFLINE_AFTER_SECONDS must exceed the stale threshold.');
  return { staleAfterSeconds, offlineAfterSeconds };
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    DeviceController,
    DeviceWebhookController,
    EdgeController,
    EdgeCustomerOperationsController,
    EdgeInstallationController,
    EdgeSnapshotController,
    EdgeSyncOperationsController,
    EdgeOperatorPairingController,
    EdgeOperatorPairingApprovalController,
    HealthController,
  ],
  providers: [
    PrismaService,
    DeviceRegistryService,
    EdgeSnapshotService,
    EdgeSyncOperationsService,
    EdgeOperatorPairingService,
    WalletEdgeMappingClient,
    EdgeCardOperationsClient,
    PricingSnapshotClient,
    EdgeOperatorTokenClient,
    EdgeProvisionalCustomerClient,
    EdgeHouseholdOperationsClient,
    EdgeIdentityLookupClient,
    EdgeOperatorPairingGatewayClient,
    DeviceIntegrationServiceTokenGuard,
    DeviceOutboxRelayService,
    PrismaDeviceRegistryRepository,
    PrismaEdgeOperatorPairingRepository,
    OrganizationBranchScopeClient,
    HmacDeviceSignatureService,
    { provide: DEVICE_REGISTRY_REPOSITORY, useExisting: PrismaDeviceRegistryRepository },
    { provide: EDGE_OPERATOR_PAIRING_REPOSITORY, useExisting: PrismaEdgeOperatorPairingRepository },
    { provide: BRANCH_SCOPE_VALIDATOR, useExisting: OrganizationBranchScopeClient },
    { provide: DEVICE_SIGNATURE_VERIFIER, useExisting: HmacDeviceSignatureService },
    {
      provide: DEVICE_HEALTH_POLICY,
      useFactory: () => {
        const policy = configuredHealthPolicy();
        return () => policy;
      },
    },
    {
      provide: DEVICE_EVENT_BUS,
      useFactory: () => new RabbitEventBus(process.env.RABBITMQ_URL, 'device-integration'),
    },
    { provide: DEVICE_RABBIT_URL, useFactory: () => process.env.RABBITMQ_URL },
  ],
})
export class AppModule {}
