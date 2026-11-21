import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitEventBus } from '@funtino/backend-core';
import { CustomerHouseholdService } from './application/customer-household.service.js';
import { CustomerProfileService } from './application/customer-profile.service.js';
import { EdgeHouseholdOperationsService } from './application/edge-household-operations.service.js';
import { EdgeProvisionalCustomerService } from './application/edge-provisional-customer.service.js';
import {
  CUSTOMER_HOUSEHOLD_EVENT_BUS,
  CUSTOMER_HOUSEHOLD_RABBIT_URL,
  CustomerHouseholdOutboxRelayService,
} from './infrastructure/messaging/customer-household-outbox-relay.service.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { CustomerHouseholdController } from './interfaces/http/customer-household.controller.js';
import { CustomerProfileController } from './interfaces/http/customer-profile.controller.js';
import { EdgeProvisionalCustomerController } from './interfaces/http/edge-provisional-customer.controller.js';
import { CustomerHouseholdEdgeServiceTokenGuard } from './interfaces/http/edge-service-token.guard.js';
import { EdgeHouseholdOperationsController } from './interfaces/http/edge-household-operations.controller.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { CustomerHouseholdServiceTokenGuard } from './interfaces/http/service-token.guard.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    CustomerHouseholdController,
    CustomerProfileController,
    EdgeProvisionalCustomerController,
    EdgeHouseholdOperationsController,
    HealthController,
  ],
  providers: [
    PrismaService,
    CustomerHouseholdService,
    CustomerProfileService,
    EdgeHouseholdOperationsService,
    EdgeProvisionalCustomerService,
    CustomerHouseholdServiceTokenGuard,
    CustomerHouseholdEdgeServiceTokenGuard,
    CustomerHouseholdOutboxRelayService,
    {
      provide: CUSTOMER_HOUSEHOLD_EVENT_BUS,
      useFactory: () => new RabbitEventBus(process.env.RABBITMQ_URL, 'customer-household'),
    },
    { provide: CUSTOMER_HOUSEHOLD_RABBIT_URL, useFactory: () => process.env.RABBITMQ_URL },
  ],
})
export class AppModule {}
