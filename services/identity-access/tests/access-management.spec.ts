import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AccessManagementCryptoService } from '../src/application/access-management-crypto.service.js';
import { AccessManagementService } from '../src/application/access-management.service.js';
import type { AccessMutationJournalService } from '../src/application/access-mutation-journal.service.js';
import type {
  OrganizationScopeValidation,
  TenantAccessScope,
} from '../src/application/ports/organization-scope-owner.port.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';

const actorUserId = '11111111-1111-4111-8111-111111111111';
const correlationId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const idempotencyKey = 'create-role-request-0001';

function configuredCryptoEnv(): () => void {
  const previousKeys = process.env.IDENTITY_ACCESS_LOOKUP_HMAC_KEYS;
  const previousVersion = process.env.IDENTITY_ACCESS_LOOKUP_ACTIVE_KEY_VERSION;
  const previousManagementWrites = process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;
  process.env.IDENTITY_ACCESS_LOOKUP_HMAC_KEYS = JSON.stringify({ v1: Buffer.alloc(32, 9).toString('base64') });
  process.env.IDENTITY_ACCESS_LOOKUP_ACTIVE_KEY_VERSION = 'v1';
  process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED = 'true';
  return () => {
    if (previousKeys === undefined) delete process.env.IDENTITY_ACCESS_LOOKUP_HMAC_KEYS;
    else process.env.IDENTITY_ACCESS_LOOKUP_HMAC_KEYS = previousKeys;
    if (previousVersion === undefined) delete process.env.IDENTITY_ACCESS_LOOKUP_ACTIVE_KEY_VERSION;
    else process.env.IDENTITY_ACCESS_LOOKUP_ACTIVE_KEY_VERSION = previousVersion;
    if (previousManagementWrites === undefined) delete process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;
    else process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED = previousManagementWrites;
  };
}

function makeService(options: {
  permissions?: string[];
  scopeValidation?: OrganizationScopeValidation;
  scopeValidationError?: Error;
} = {}) {
  const idempotencyRecords = new Map<string, Record<string, unknown>>();
  const createdRoles: Array<Record<string, unknown>> = [];
  let journalWrites = 0;
  let deniedWrites = 0;
  let managementGateAuditWrites = 0;
  const validatedScopes: TenantAccessScope[] = [];
  const rolePermissions = options.permissions ?? ['access.role.manage', 'access.permission.delegate', 'access.role.read', 'staff.read'];
  const tx = {
    $queryRaw: async () => [{ id: 1 }],
    staffMembership: {
      findMany: async () => [{
        id: '44444444-4444-4444-8444-444444444444', userId: actorUserId,
        scopeType: 'global', organizationId: null, branchId: null, roleId: '55555555-5555-4555-8555-555555555555',
        status: 'active', version: 1,
        role: {
          id: '55555555-5555-4555-8555-555555555555', scopeType: 'global', organizationId: null,
          branchId: null, status: 'active', permissions: rolePermissions.map((permissionKey) => ({ permissionKey })),
        },
        overrides: [],
      }],
    },
    policyState: { findUnique: async () => ({ id: 1, version: 3 }) },
    mfaCredential: { findUnique: async () => ({ status: 'active', version: 4 }) },
    accessIdempotencyRecord: {
      findUnique: async ({ where }: { where: { actorUserId_operation_key: { actorUserId: string; operation: string; key: string } } }) =>
        idempotencyRecords.get(`${where.actorUserId_operation_key.actorUserId}:${where.actorUserId_operation_key.operation}:${where.actorUserId_operation_key.key}`) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        idempotencyRecords.set(`${data.actorUserId}:${data.operation}:${data.key}`, { ...data, id: '66666666-6666-4666-8666-666666666666', createdAt: new Date(), completedAt: new Date() });
        return data;
      },
      delete: async () => undefined,
    },
    accessAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        managementGateAuditWrites += 1;
        return data;
      },
    },
    accessRole: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const permissionData = data.permissions as { create: Array<{ permissionKey: string }> };
        const role = {
          id: data.id, name: data.name, scopeType: data.scopeType,
          organizationId: data.organizationId, branchId: data.branchId,
          status: 'active', systemManaged: false, version: 1,
          permissions: permissionData.create,
        };
        createdRoles.push(role);
        return role;
      },
    },
    staffInvitation: {
      findMany: async () => [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'pending', scopeType: 'global', organizationId: null, branchId: null,
        maskedPhone: '+98••••••۱۲۳۴', expiresAt: new Date(Date.now() + 60_000), roleVersion: 1,
        role: {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Support', scopeType: 'global',
          organizationId: null, branchId: null, status: 'active', systemManaged: false, version: 1,
          permissions: [{ permissionKey: 'staff.read' }],
        },
      }],
    },
  };
  const prisma = {
    $transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx),
  } as unknown as PrismaService;
  const journal = {
    recordCommittedChange: async () => ({ auditId: '77777777-7777-4777-8777-777777777777', eventId: '88888888-8888-4888-8888-888888888888', policyVersion: 4 + journalWrites++ }),
    recordDeniedAttempt: async () => ({ auditId: `denied-${++deniedWrites}` }),
    recordSensitiveAccess: async () => ({ auditId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  } as unknown as AccessMutationJournalService;
  const scopeOwner = {
    validateScope: async (scope: TenantAccessScope) => {
      validatedScopes.push(scope);
      if (options.scopeValidationError) throw options.scopeValidationError;
      return options.scopeValidation ?? {
        valid: true as const,
        organizationId: scope.organizationId,
        organizationVersion: 1,
        ...(scope.type === 'branch' ? { branchId: scope.branchId, branchVersion: 1 } : {}),
      };
    },
  };
  return {
    service: new AccessManagementService(prisma, journal, new AccessManagementCryptoService(), scopeOwner),
    createdRoles,
    idempotencyRecords,
    validatedScopes,
    get journalWrites() { return journalWrites; },
    get deniedWrites() { return deniedWrites; },
    get managementGateAuditWrites() { return managementGateAuditWrites; },
  };
}

test('production administrative writes fail closed and record a non-sensitive gate audit', async () => {
  const restore = configuredCryptoEnv();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  delete process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;
  try {
    const fixture = makeService();
    await assert.rejects(
      fixture.service.createRole(
        actorUserId,
        {
          name: 'Support role',
          scope: { type: 'global' },
          permissionKeys: ['access.role.read'],
          reason: 'Prepare a constrained support role.',
        },
        {
          correlationId,
          idempotencyKey: 'closed-manager-write-0001',
          stepUp: { sessionId, verifiedAt: new Date().toISOString(), factorVersion: 4, method: 'totp' },
        },
      ),
      ServiceUnavailableException,
    );
    assert.equal(fixture.createdRoles.length, 0);
    assert.equal(fixture.idempotencyRecords.size, 0);
    assert.equal(fixture.validatedScopes.length, 0);
    assert.equal(fixture.managementGateAuditWrites, 1);
    assert.equal(fixture.deniedWrites, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    restore();
  }
});

test('production gate also blocks pending invitation acceptance until IAM writes are opened', async () => {
  const restore = configuredCryptoEnv();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  delete process.env.IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED;
  try {
    const fixture = makeService();
    await assert.rejects(
      fixture.service.acceptInvitation(
        actorUserId,
        '99999999-9999-4999-8999-999999999999',
        '+989121234567',
        { correlationId, idempotencyKey: 'closed-invitation-accept-01' },
      ),
      ServiceUnavailableException,
    );
    assert.equal(fixture.idempotencyRecords.size, 0);
    assert.equal(fixture.managementGateAuditWrites, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    restore();
  }
});

test('role creation is idempotent and rejects reuse of its key for a different body', async () => {
  const restore = configuredCryptoEnv();
  try {
    const fixture = makeService();
    const { service, createdRoles } = fixture;
    const meta = {
      correlationId, idempotencyKey,
      stepUp: { sessionId, verifiedAt: new Date().toISOString(), factorVersion: 4, method: 'totp' as const },
    };
    const input = {
      name: 'Least privilege', scope: { type: 'global' as const },
      permissionKeys: ['access.role.read'], reason: 'Approved for support operators.',
    };
    const first = await service.createRole(actorUserId, input, meta);
    const retry = await service.createRole(actorUserId, input, meta);
    assert.deepEqual(retry, first);
    assert.equal(createdRoles.length, 1);
    assert.equal(fixture.journalWrites, 1);

    await assert.rejects(
      service.createRole(actorUserId, { ...input, name: 'Different role' }, meta),
      (error: unknown) => error instanceof ConflictException,
    );
    assert.equal(createdRoles.length, 1);
  } finally {
    restore();
  }
});

test('production tenant role writes require an active owner scope after IAM authorization', async () => {
  const restore = configuredCryptoEnv();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const fixture = makeService();
    const result = await fixture.service.createRole(
      actorUserId,
      {
        name: 'Branch support',
        scope: { type: 'branch', organizationId: '11111111-1111-4111-8111-111111111111', branchId: '22222222-2222-4222-8222-222222222222' },
        permissionKeys: ['access.role.read'],
        reason: 'Create a branch-scoped support role.',
      },
      {
        correlationId,
        idempotencyKey: 'create-branch-role-request-01',
        stepUp: { sessionId, verifiedAt: new Date().toISOString(), factorVersion: 4, method: 'totp' },
      },
    );

    assert.equal('data' in result, true);
    assert.equal(fixture.validatedScopes.length, 1);
    assert.deepEqual(fixture.validatedScopes[0], {
      type: 'branch',
      organizationId: '11111111-1111-4111-8111-111111111111',
      branchId: '22222222-2222-4222-8222-222222222222',
    });
    assert.equal(fixture.createdRoles.length, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    restore();
  }
});

test('inactive production owner scope is denied, audited, and not written', async () => {
  const restore = configuredCryptoEnv();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const fixture = makeService({ scopeValidation: { valid: false, reason: 'organization_unavailable' } });
    await assert.rejects(
      fixture.service.createRole(
        actorUserId,
        {
          name: 'Branch support',
          scope: { type: 'organization', organizationId: '11111111-1111-4111-8111-111111111111' },
          permissionKeys: ['access.role.read'],
          reason: 'Create a scoped role.',
        },
        {
          correlationId,
          idempotencyKey: 'create-invalid-scope-role-01',
          stepUp: { sessionId, verifiedAt: new Date().toISOString(), factorVersion: 4, method: 'totp' },
        },
      ),
      ForbiddenException,
    );
    assert.equal(fixture.validatedScopes.length, 1);
    assert.equal(fixture.createdRoles.length, 0);
    assert.equal(fixture.idempotencyRecords.size, 0);
    assert.equal(fixture.journalWrites, 0);
    assert.equal(fixture.deniedWrites, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    restore();
  }
});

test('unauthorized IAM actor is rejected before calling the scope owner', async () => {
  const restore = configuredCryptoEnv();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const fixture = makeService({ permissions: ['staff.read'] });
    await assert.rejects(
      fixture.service.createRole(
        actorUserId,
        {
          name: 'Branch support',
          scope: { type: 'organization', organizationId: '11111111-1111-4111-8111-111111111111' },
          permissionKeys: ['access.role.read'],
          reason: 'Attempt a scoped role change.',
        },
        {
          correlationId,
          idempotencyKey: 'unauthorized-scope-role-01',
          stepUp: { sessionId, verifiedAt: new Date().toISOString(), factorVersion: 4, method: 'totp' },
        },
      ),
      ForbiddenException,
    );
    assert.equal(fixture.validatedScopes.length, 0);
    assert.equal(fixture.createdRoles.length, 0);
    assert.equal(fixture.deniedWrites, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    restore();
  }
});

test('owner outage fails closed without committing the IAM mutation', async () => {
  const restore = configuredCryptoEnv();
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const fixture = makeService({
      scopeValidationError: new ServiceUnavailableException('Owner is unavailable.'),
    });
    await assert.rejects(
      fixture.service.createRole(
        actorUserId,
        {
          name: 'Branch support',
          scope: { type: 'organization', organizationId: '11111111-1111-4111-8111-111111111111' },
          permissionKeys: ['access.role.read'],
          reason: 'Create a scoped role.',
        },
        {
          correlationId,
          idempotencyKey: 'owner-outage-scope-role-01',
          stepUp: { sessionId, verifiedAt: new Date().toISOString(), factorVersion: 4, method: 'totp' },
        },
      ),
      ServiceUnavailableException,
    );
    assert.equal(fixture.createdRoles.length, 0);
    assert.equal(fixture.idempotencyRecords.size, 0);
    assert.equal(fixture.journalWrites, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    restore();
  }
});

test('scoped invitation listing returns only masked data and records a sensitive read audit', async () => {
  const restore = configuredCryptoEnv();
  try {
    const fixture = makeService();
    const result = await fixture.service.listScopedInvitations(
      actorUserId,
      { type: 'global' },
      { pageSize: 25 },
      correlationId,
    );
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.status, 'pending');
    assert.equal(result.data[0]?.maskedPhone, '+98••••••۱۲۳۴');
    assert.equal('phoneE164' in (result.data[0] ?? {}), false);
    assert.equal(result.policyVersion, 3);
  } finally {
    restore();
  }
});
