import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { permissionCatalogVersion } from '../../domain/authorization/permission-catalog.js';
import { MfaCryptoService } from '../../application/mfa-crypto.service.js';
import { AccessManagementCryptoService } from '../../application/access-management-crypto.service.js';
import { OrganizationScopeOwnerClient } from '../../infrastructure/organization-branch/organization-scope-owner.client.js';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service.js';
import { areManagementWritesEnabled } from '../../application/management-write-gate.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfaCrypto: MfaCryptoService,
    private readonly accessManagementCrypto: AccessManagementCryptoService,
    private readonly organizationScopeOwner: OrganizationScopeOwnerClient,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', service: 'identity-access', version: process.env.APP_VERSION ?? 'dev' };
  }

  @Get('ready')
  async ready() {
    if ((process.env.IDENTITY_ACCESS_SERVICE_TOKEN?.length ?? 0) < 32) {
      throw new ServiceUnavailableException('Service authentication is not configured.');
    }
    if (!this.mfaCrypto.isConfigured()) {
      throw new ServiceUnavailableException('MFA encryption is not configured.');
    }
    if (!this.accessManagementCrypto.isConfigured()) {
      throw new ServiceUnavailableException('Identity access lookup hashing is not configured.');
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const [policy, pendingEvents, deadLetterEvents] = await Promise.all([
        this.prisma.policyState.findUnique({ where: { id: 1 } }),
        this.prisma.outboxEvent.count({ where: { publishedAt: null, deadLetteredAt: null } }),
        this.prisma.outboxEvent.count({ where: { deadLetteredAt: { not: null } } }),
      ]);
      if (!policy || policy.version < 1 || permissionCatalogVersion < 1) {
        throw new ServiceUnavailableException('The policy catalog or database is not initialized.');
      }
      const production = process.env.NODE_ENV === 'production';
      const scopeValidationConfigured = this.organizationScopeOwner.isConfigured();
      const administrativeWritesEnabled = areManagementWritesEnabled();
      const defaultNonproduction = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
      let administrativeWritesMode: string;
      if (production) {
        administrativeWritesMode = administrativeWritesEnabled
          ? 'explicit-production-opt-in'
          : 'closed-by-default';
      } else if (defaultNonproduction) {
        administrativeWritesMode = 'nonproduction-enabled';
      } else if (administrativeWritesEnabled) {
        administrativeWritesMode = 'explicit-runtime-opt-in';
      } else {
        administrativeWritesMode = process.env.NODE_ENV
          ? 'environment-gate-closed'
          : 'unknown-environment-closed';
      }
      const scopedTenantWriteBlockReason = !administrativeWritesEnabled
        ? 'administrative_writes_disabled'
        : production && !scopeValidationConfigured
          ? 'organization_branch_scope_owner_not_configured'
          : null;
      const scopedTenantWritesEnabled = scopedTenantWriteBlockReason === null;
      return {
        status: 'ready',
        service: 'identity-access',
        catalogVersion: permissionCatalogVersion,
        policyVersion: policy.version,
        administrativeWrites: {
          enabled: administrativeWritesEnabled,
          mode: administrativeWritesMode,
          blockReason: administrativeWritesEnabled ? null : 'administrative_writes_disabled',
        },
        scopedTenantWritesEnabled,
        scopedTenantWriteBlockReason,
        scopeValidation: {
          configured: scopeValidationConfigured,
          mode: production ? 'owner-api-on-every-tenant-mutation' : 'nonproduction-opaque-scopes',
          failClosed: true,
        },
        outbox: {
          pending: pendingEvents,
          deadLettered: deadLetterEvents,
          publisherConfigured: Boolean(process.env.RABBITMQ_URL),
        },
      };
    } catch {
      throw new ServiceUnavailableException('The policy database is not ready.');
    }
  }
}
