import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitEventBus } from '@funtino/backend-core';
import { CardInventoryService } from './application/card-inventory.service.js';
import { CardLedgerService } from './application/card-ledger.service.js';
import { CardBalanceLookupService } from './application/card-balance-lookup.service.js';
import { CardLedgerEventConsumer } from './application/card-ledger-event-consumer.service.js';
import { CardLifecycleRequestService } from './application/card-lifecycle-request.service.js';
import { HOUSEHOLD_VALIDATOR } from './application/ports/household-validator.port.js';
import { BRANCH_SCOPE_VALIDATOR } from './application/ports/branch-scope-validator.port.js';
import { CARD_INVENTORY_REPOSITORY } from './application/ports/card-inventory.repository.js';
import {
  WalletOutboxRelayService,
  WALLET_EVENT_BUS,
  WALLET_RABBIT_URL,
} from './infrastructure/messaging/outbox/wallet-outbox-relay.service.js';
import { OrganizationBranchScopeClient } from './infrastructure/organization-branch/organization-branch-scope.client.js';
import { CustomerHouseholdValidationClient } from './infrastructure/customer-household/customer-household-validation.client.js';
import { PrismaCardInventoryRepository } from './infrastructure/persistence/prisma/prisma-card-inventory.repository.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { CardInventoryController } from './interfaces/http/card-inventory.controller.js';
import { CardAssignmentController } from './interfaces/http/card-assignment.controller.js';
import { CardLedgerController } from './interfaces/http/card-ledger.controller.js';
import { CardBalanceLookupController } from './interfaces/http/card-balance-lookup.controller.js';
import { EdgeCardMappingController } from './interfaces/http/edge-card-mapping.controller.js';
import { WalletDeviceIntegrationTokenGuard } from './interfaces/http/device-integration-token.guard.js';
import { CardLifecycleRequestController } from './interfaces/http/card-lifecycle-request.controller.js';
import { EdgeBalanceReconciliationController } from './interfaces/http/edge-balance-reconciliation.controller.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { WalletServiceTokenGuard } from './interfaces/http/service-token.guard.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    CardInventoryController,
    CardAssignmentController,
    CardLedgerController,
    CardBalanceLookupController,
    EdgeCardMappingController,
    CardLifecycleRequestController,
    EdgeBalanceReconciliationController,
    HealthController,
  ],
  providers: [
    PrismaService,
    CardInventoryService,
    CardLedgerService,
    CardBalanceLookupService,
    CardLedgerEventConsumer,
    CardLifecycleRequestService,
    WalletServiceTokenGuard,
    WalletDeviceIntegrationTokenGuard,
    WalletOutboxRelayService,
    PrismaCardInventoryRepository,
    OrganizationBranchScopeClient,
    CustomerHouseholdValidationClient,
    { provide: CARD_INVENTORY_REPOSITORY, useExisting: PrismaCardInventoryRepository },
    { provide: BRANCH_SCOPE_VALIDATOR, useExisting: OrganizationBranchScopeClient },
    { provide: HOUSEHOLD_VALIDATOR, useExisting: CustomerHouseholdValidationClient },
    {
      provide: WALLET_EVENT_BUS,
      useFactory: () => new RabbitEventBus(process.env.RABBITMQ_URL, 'wallet'),
    },
    { provide: WALLET_RABBIT_URL, useFactory: () => process.env.RABBITMQ_URL },
  ],
})
export class AppModule {}
