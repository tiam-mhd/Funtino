import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { AccessManagementCryptoService } from '../src/application/access-management-crypto.service.js';
import { MfaCryptoService } from '../src/application/mfa-crypto.service.js';
import { HealthController } from '../src/interfaces/http/health.controller.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';
import type { OrganizationScopeOwnerClient } from '../src/infrastructure/organization-branch/organization-scope-owner.client.js';

const previousNodeEnv = process.env.NODE_ENV;
const previousServiceToken = process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
const previousManagementWrites = process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;

function restoreEnvironment(): void {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousServiceToken === undefined) delete process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
  else process.env.IDENTITY_ACCESS_SERVICE_TOKEN = previousServiceToken;
  if (previousManagementWrites === undefined) delete process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;
  else process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED = previousManagementWrites;
}

function controller(scopeOwnerConfigured: boolean): HealthController {
  const prisma = {
    $queryRaw: async () => [],
    policyState: { findUnique: async () => ({ id: 1, version: 1 }) },
    outboxEvent: { count: async () => 0 },
  } as unknown as PrismaService;
  const mfaCrypto = { isConfigured: () => true } as MfaCryptoService;
  const accessCrypto = { isConfigured: () => true } as AccessManagementCryptoService;
  const scopeOwner = { isConfigured: () => scopeOwnerConfigured } as OrganizationScopeOwnerClient;
  return new HealthController(prisma, mfaCrypto, accessCrypto, scopeOwner);
}

test('production IAM manager writes are closed by default and readiness reports the gate', async () => {
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;
    process.env.IDENTITY_ACCESS_SERVICE_TOKEN = 'runtime-only-identity-token-0123456789';
    const result = await controller(false).ready();
    assert.deepEqual(result.administrativeWrites, {
      enabled: false,
      mode: 'closed-by-default',
      blockReason: 'administrative_writes_disabled',
    });
    assert.equal(result.scopedTenantWritesEnabled, false);
    assert.equal(
      result.scopedTenantWriteBlockReason,
      'administrative_writes_disabled',
    );
    assert.deepEqual(result.scopeValidation, {
      configured: false,
      mode: 'owner-api-on-every-tenant-mutation',
      failClosed: true,
    });
  } finally {
    restoreEnvironment();
  }
});

test('production IAM tenant writes still require a configured owner after the manager gate opens', async () => {
  try {
    process.env.NODE_ENV = 'production';
    process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED = 'true';
    process.env.IDENTITY_ACCESS_SERVICE_TOKEN = 'runtime-only-identity-token-0123456789';
    const result = await controller(false).ready();
    assert.equal(result.administrativeWrites.enabled, true);
    assert.equal(result.scopedTenantWritesEnabled, false);
    assert.equal(result.scopedTenantWriteBlockReason, 'organization_branch_scope_owner_not_configured');
    assert.equal(result.scopeValidation.configured, false);
    assert.equal(result.scopeValidation.failClosed, true);
  } finally {
    restoreEnvironment();
  }
});

test('production readiness reports tenant writes open only when both explicit gates are configured', async () => {
  try {
    process.env.NODE_ENV = 'production';
    process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED = 'true';
    process.env.IDENTITY_ACCESS_SERVICE_TOKEN = 'runtime-only-identity-token-0123456789';
    const result = await controller(true).ready();
    assert.equal(result.administrativeWrites.mode, 'explicit-production-opt-in');
    assert.equal(result.administrativeWrites.blockReason, null);
    assert.equal(result.scopedTenantWritesEnabled, true);
    assert.equal(result.scopedTenantWriteBlockReason, null);
  } finally {
    restoreEnvironment();
  }
});

test('nonproduction IAM keeps opaque-scope development enabled without owner credentials', async () => {
  try {
    process.env.NODE_ENV = 'test';
    process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED = 'false';
    process.env.IDENTITY_ACCESS_SERVICE_TOKEN = 'runtime-only-identity-token-0123456789';
    const result = await controller(false).ready();
    assert.equal(result.administrativeWrites.enabled, true);
    assert.equal(result.administrativeWrites.mode, 'nonproduction-enabled');
    assert.equal(result.scopedTenantWritesEnabled, true);
    assert.equal(result.scopedTenantWriteBlockReason, null);
    assert.equal(result.scopeValidation.mode, 'nonproduction-opaque-scopes');
  } finally {
    restoreEnvironment();
  }
});

test('IAM readiness treats a missing runtime environment as closed, not nonproduction', async () => {
  try {
    delete process.env.NODE_ENV;
    delete process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;
    process.env.IDENTITY_ACCESS_SERVICE_TOKEN = 'runtime-only-identity-token-0123456789';
    const result = await controller(false).ready();
    assert.deepEqual(result.administrativeWrites, {
      enabled: false,
      mode: 'unknown-environment-closed',
      blockReason: 'administrative_writes_disabled',
    });
    assert.equal(result.scopedTenantWritesEnabled, false);
  } finally {
    restoreEnvironment();
  }
});

test('IAM readiness requires an explicit manager-write opt-in in staging', async () => {
  try {
    process.env.NODE_ENV = 'staging';
    delete process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;
    process.env.IDENTITY_ACCESS_SERVICE_TOKEN = 'runtime-only-identity-token-0123456789';
    const result = await controller(true).ready();
    assert.deepEqual(result.administrativeWrites, {
      enabled: false,
      mode: 'environment-gate-closed',
      blockReason: 'administrative_writes_disabled',
    });
  } finally {
    restoreEnvironment();
  }
});

test('IAM readiness remains unavailable when internal service authentication is missing', async () => {
  try {
    delete process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
    await assert.rejects(() => controller(false).ready(), ServiceUnavailableException);
  } finally {
    restoreEnvironment();
  }
});
