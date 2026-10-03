import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitEventBus } from '@funtino/backend-core';
import {
  DEVICE_HEALTH_POLICY,
  DeviceRegistryService,
} from './application/device-registry.service.js';
import type { DeviceHealthPolicy } from './domain/device/device.js';
import { BRANCH_SCOPE_VALIDATOR } from './application/ports/branch-scope-validator.port.js';
import { DEVICE_REGISTRY_REPOSITORY } from './application/ports/device-registry.repository.js';
import { DEVICE_SIGNATURE_VERIFIER } from './application/ports/device-signature-verifier.port.js';
import {
  DeviceOutboxRelayService,
  DEVICE_EVENT_BUS,
  DEVICE_RABBIT_URL,
} from './infrastructure/messaging/outbox/device-outbox-relay.service.js';
import { PrismaDeviceRegistryRepository } from './infrastructure/persistence/prisma/prisma-device-registry.repository.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { OrganizationBranchScopeClient } from './infrastructure/organization-branch/organization-branch-scope.client.js';
import { HmacDeviceSignatureService } from './infrastructure/security/hmac-device-signature.service.js';
import { DeviceController, DeviceWebhookController } from './interfaces/http/device.controller.js';
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
  controllers: [DeviceController, DeviceWebhookController, HealthController],
  providers: [
    PrismaService,
    DeviceRegistryService,
    DeviceIntegrationServiceTokenGuard,
    DeviceOutboxRelayService,
    PrismaDeviceRegistryRepository,
    OrganizationBranchScopeClient,
    HmacDeviceSignatureService,
    { provide: DEVICE_REGISTRY_REPOSITORY, useExisting: PrismaDeviceRegistryRepository },
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
