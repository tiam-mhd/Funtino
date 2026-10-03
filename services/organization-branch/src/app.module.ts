import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitEventBus } from '@funtino/backend-core';
import { OrganizationBranchService } from './application/organization-branch.service.js';
import {
  ORGANIZATION_BRANCH_EVENT_BUS,
  ORGANIZATION_BRANCH_RABBIT_URL,
  OrganizationBranchOutboxRelayService,
} from './infrastructure/messaging/outbox/organization-branch-outbox-relay.service.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { OrganizationBranchController } from './interfaces/http/organization-branch.controller.js';
import { OrganizationBranchServiceTokenGuard } from './interfaces/http/service-token.guard.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, OrganizationBranchController],
  providers: [
    PrismaService,
    OrganizationBranchService,
    OrganizationBranchServiceTokenGuard,
    OrganizationBranchOutboxRelayService,
    {
      provide: ORGANIZATION_BRANCH_EVENT_BUS,
      useFactory: () => new RabbitEventBus(process.env.RABBITMQ_URL, 'organization-branch'),
    },
    { provide: ORGANIZATION_BRANCH_RABBIT_URL, useFactory: () => process.env.RABBITMQ_URL },
  ],
})
export class AppModule {}
