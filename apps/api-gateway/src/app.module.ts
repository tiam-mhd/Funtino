import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './application/auth/auth.service.js';
import { CustomerService } from './application/customer/customer.service.js';
import { OutboxRelay } from './application/outbox/outbox-relay.service.js';
import { WalletEventConsumer } from './application/wallet/wallet-event-consumer.service.js';
import { AuthController } from './interfaces/http/auth.controller.js';
import { CustomerController } from './interfaces/http/customer.controller.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { OperationsAccessController } from './interfaces/http/operations-access.controller.js';
import { OperationsDevicesController } from './interfaces/http/operations-devices.controller.js';
import { OperationsMfaController } from './interfaces/http/operations-mfa.controller.js';
import { OperationsReportsController } from './interfaces/http/operations-reports.controller.js';
import { OperationsScopeController } from './interfaces/http/operations-scope.controller.js';
import { SystemOrganizationController } from './interfaces/http/system-organization.controller.js';
import { SystemHealthController } from './interfaces/http/system-health.controller.js';
import { SystemSessionPolicyController } from './interfaces/http/system-session-policy.controller.js';
import { SystemBootstrapOwnerController } from './interfaces/http/system-bootstrap-owner.controller.js';
import { IdentityAccessBootstrapLookupGuard } from './interfaces/http/identity-access-bootstrap-lookup.guard.js';
import { OperationsCardsController } from './interfaces/http/operations-cards.controller.js';
import { SessionGuard } from './interfaces/http/session.guard.js';
import { TrustedOriginGuard } from './interfaces/http/trusted-origin.guard.js';
import { IdentityAccessClient } from './infrastructure/identity-access/identity-access.client.js';
import { CustomerHouseholdClient } from './infrastructure/customer-household/customer-household.client.js';
import { DeviceIntegrationClient } from './infrastructure/device-integration/device-integration.client.js';
import { OrganizationBranchClient } from './infrastructure/organization-branch/organization-branch.client.js';
import { AnalyticsReportClient } from './infrastructure/analytics/analytics-report.client.js';
import { WalletClient } from './infrastructure/wallet/wallet.client.js';
import { FUNTINO_STORE, InMemoryFuntinoStore } from './infrastructure/store/funtino-store.js';
import { PrismaFuntinoStore } from './infrastructure/store/prisma-store.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { OTP_SENDER } from './infrastructure/notifications/otp-sender.js';
import { ParsGreenOtpSender } from './infrastructure/notifications/pars-green-otp.sender.js';
import { PrometheusTelemetryClient } from './infrastructure/observability/prometheus-telemetry.client.js';
import { FormsClient } from './infrastructure/forms/forms.client.js';
import { CustomerFormsController } from './interfaces/http/customer-forms.controller.js';
import { CustomerOptionalSessionGuard } from './interfaces/http/customer-optional-session.guard.js';
import { OperationsFormsController } from './interfaces/http/operations-forms.controller.js';
import { SystemFormsController } from './interfaces/http/system-forms.controller.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    AuthController,
    CustomerController,
    CustomerFormsController,
    HealthController,
    OperationsAccessController,
    OperationsCardsController,
    OperationsDevicesController,
    OperationsFormsController,
    OperationsMfaController,
    OperationsReportsController,
    OperationsScopeController,
    SystemOrganizationController,
    SystemFormsController,
    SystemHealthController,
    SystemSessionPolicyController,
    SystemBootstrapOwnerController,
  ],
  providers: [
    PrismaService,
    {
      provide: FUNTINO_STORE,
      useFactory: (prisma: PrismaService, organizationBranch: OrganizationBranchClient) => {
        if (process.env.STORAGE_MODE === 'postgres') {
          return new PrismaFuntinoStore(prisma, organizationBranch);
        }
        return new InMemoryFuntinoStore();
      },
      inject: [PrismaService, OrganizationBranchClient],
    },
    AuthService,
    { provide: OTP_SENDER, useClass: ParsGreenOtpSender },
    CustomerService,
    IdentityAccessClient,
    CustomerHouseholdClient,
    DeviceIntegrationClient,
    OrganizationBranchClient,
    AnalyticsReportClient,
    FormsClient,
    WalletClient,
    PrometheusTelemetryClient,
    SessionGuard,
    CustomerOptionalSessionGuard,
    IdentityAccessBootstrapLookupGuard,
    TrustedOriginGuard,
    OutboxRelay,
    WalletEventConsumer,
  ],
})
export class AppModule {}
