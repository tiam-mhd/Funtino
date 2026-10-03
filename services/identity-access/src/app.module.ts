import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitEventBus } from '@funtino/backend-core';
import { AccessMutationJournalService } from './application/access-mutation-journal.service.js';
import { AccessManagementService } from './application/access-management.service.js';
import { AccessManagementCryptoService } from './application/access-management-crypto.service.js';
import { AccessPolicyService } from './application/access-policy.service.js';
import { ORGANIZATION_SCOPE_OWNER } from './application/ports/organization-scope-owner.port.js';
import { MfaCryptoService } from './application/mfa-crypto.service.js';
import { MfaService } from './application/mfa.service.js';
import {
  ACCESS_EVENT_BUS,
  ACCESS_RABBIT_URL,
  AccessOutboxRelayService,
} from './infrastructure/messaging/outbox/access-outbox-relay.service.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { OrganizationScopeOwnerClient } from './infrastructure/organization-branch/organization-scope-owner.client.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { IdentityAccessController } from './interfaces/http/identity-access.controller.js';
import { ServiceTokenGuard } from './interfaces/http/service-token.guard.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, IdentityAccessController],
  providers: [
    PrismaService,
    AccessPolicyService,
    AccessManagementService,
    AccessManagementCryptoService,
    OrganizationScopeOwnerClient,
    { provide: ORGANIZATION_SCOPE_OWNER, useExisting: OrganizationScopeOwnerClient },
    MfaCryptoService,
    MfaService,
    AccessMutationJournalService,
    ServiceTokenGuard,
    AccessOutboxRelayService,
    {
      provide: ACCESS_EVENT_BUS,
      useFactory: () => new RabbitEventBus(process.env.RABBITMQ_URL, 'identity-access'),
    },
    { provide: ACCESS_RABBIT_URL, useFactory: () => process.env.RABBITMQ_URL },
  ],
})
export class AppModule {}
