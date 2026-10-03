import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { createTotpForTest, MfaCryptoService } from '../src/application/mfa-crypto.service.js';
import { MfaService, type MfaContext } from '../src/application/mfa.service.js';
import type { PrismaService } from '../src/infrastructure/persistence/prisma/prisma.service.js';

const context: MfaContext = {
  actorUserId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  correlationId: '33333333-3333-4333-8333-333333333333',
};

type FakeCredential = {
  userId: string;
  status: 'pending' | 'active' | 'disabled';
  secretCiphertext: Buffer;
  secretNonce: Buffer;
  secretAuthTag: Buffer;
  encryptionKeyVersion: string;
  pendingExpiresAt: Date | null;
  enabledAt: Date | null;
  lastAcceptedStep: bigint | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  version: number;
};
type FakeRecoveryCode = {
  id: string;
  userId: string;
  credentialVersion: number;
  codeHash: string;
  consumedAt: Date | null;
  revokedAt: Date | null;
};

function fixture() {
  const previousKeys = process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS;
  const previousVersion = process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION;
  process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS = JSON.stringify({
    v1: Buffer.alloc(32, 9).toString('base64'),
  });
  process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION = 'v1';

  let credential: FakeCredential | null = null;
  const recoveryCodes: FakeRecoveryCode[] = [];
  const audits: Array<Record<string, unknown>> = [];
  let nextId = 0;
  const tx = {
    mfaCredential: {
      findUnique: async () => (credential ? { ...credential } : null),
      create: async ({
        data,
      }: {
        data: Omit<
          FakeCredential,
          'failedAttempts' | 'lockedUntil' | 'lastAcceptedStep' | 'enabledAt'
        >;
      }) => {
        credential = {
          ...data,
          failedAttempts: 0,
          lockedUntil: null,
          lastAcceptedStep: null,
          enabledAt: null,
        };
        return { ...credential };
      },
      update: async ({
        data,
        select,
      }: {
        data: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        assert.ok(credential);
        const updated = { ...credential } as FakeCredential;
        for (const [key, value] of Object.entries(data)) {
          if (key === 'failedAttempts' && typeof value === 'object' && value !== null) {
            updated.failedAttempts += (value as { increment: number }).increment;
          } else if (key === 'version' && typeof value === 'object' && value !== null) {
            updated.version += (value as { increment: number }).increment;
          } else {
            (updated as unknown as Record<string, unknown>)[key] = value;
          }
        }
        credential = updated;
        return select ? { failedAttempts: credential.failedAttempts } : { ...credential };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (!credential || credential.userId !== where.userId) return { count: 0 };
        if (where.status && credential.status !== where.status) return { count: 0 };
        if (where.version && credential.version !== where.version) return { count: 0 };
        if (
          where.pendingExpiresAt &&
          credential.pendingExpiresAt &&
          credential.pendingExpiresAt <= (where.pendingExpiresAt as { gt: Date }).gt
        )
          return { count: 0 };
        if (Array.isArray(where.OR)) {
          const allowed = (where.OR as Array<Record<string, unknown>>).some((condition) => {
            if ('lastAcceptedStep' in condition && condition.lastAcceptedStep === null) {
              return credential?.lastAcceptedStep === null;
            }
            const lt = (condition.lastAcceptedStep as { lt?: bigint } | undefined)?.lt;
            return (
              lt !== undefined &&
              credential?.lastAcceptedStep !== null &&
              credential!.lastAcceptedStep! < lt
            );
          });
          if (!allowed) return { count: 0 };
        }
        Object.assign(credential, data);
        return { count: 1 };
      },
    },
    mfaRecoveryCode: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        recoveryCodes.filter(
          (row) =>
            row.userId === where.userId &&
            row.credentialVersion === where.credentialVersion &&
            (where.consumedAt === undefined || row.consumedAt === where.consumedAt) &&
            (where.revokedAt === undefined || row.revokedAt === where.revokedAt),
        ).length,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const matches = recoveryCodes.filter(
          (row) =>
            row.userId === where.userId &&
            (where.credentialVersion === undefined ||
              row.credentialVersion === where.credentialVersion) &&
            (where.codeHash === undefined || row.codeHash === where.codeHash) &&
            (where.consumedAt === undefined || row.consumedAt === where.consumedAt) &&
            (where.revokedAt === undefined || row.revokedAt === where.revokedAt),
        );
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      },
      createMany: async ({
        data,
      }: {
        data: Array<{ userId: string; credentialVersion: number; codeHash: string }>;
      }) => {
        for (const row of data) {
          recoveryCodes.push({
            id: `recovery-${++nextId}`,
            ...row,
            consumedAt: null,
            revokedAt: null,
          });
        }
        return { count: data.length };
      },
    },
    mfaAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(structuredClone(data));
        return data;
      },
    },
  };
  const prisma = {
    staffMembership: {
      findMany: async () => [{
        status: 'active',
        createdAt: new Date(),
        role: { name: 'system_admin' },
      }],
    },
    mfaCredential: tx.mfaCredential,
    mfaRecoveryCode: tx.mfaRecoveryCode,
    $transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx),
  } as unknown as PrismaService;

  return {
    service: new MfaService(prisma, new MfaCryptoService()),
    get credential() {
      return credential;
    },
    recoveryCodes,
    audits,
    restore() {
      if (previousKeys === undefined) delete process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS;
      else process.env.IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS = previousKeys;
      if (previousVersion === undefined) delete process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION;
      else process.env.IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION = previousVersion;
    },
  };
}

function totpForNextStep(secret: string): string {
  const step = Math.floor(Date.now() / 30_000) + 1;
  return createTotpForTest(secret, new Date(step * 30_000 + 1_000));
}

test('enrollment returns ten codes once, stores only hashes and audits without secret material', async () => {
  const f = fixture();
  try {
    const started = await f.service.startEnrollment(context);
    assert.match(started.otpauthUri, /^otpauth:\/\/totp\//);
    assert.ok(f.credential);
    assert.notEqual(f.credential.secretCiphertext.toString('utf8'), started.secret);

    const confirmed = await f.service.confirmEnrollment(
      context,
      createTotpForTest(started.secret, new Date()),
    );
    assert.equal(confirmed.recoveryCodes.length, 10);
    assert.equal(confirmed.factorVersion, 2);
    assert.equal(f.credential.status, 'active');
    assert.equal(f.recoveryCodes.length, 10);
    assert.notEqual(f.recoveryCodes[0]?.codeHash, confirmed.recoveryCodes[0]);
    assert.ok(f.audits.some((entry) => entry.action === 'mfa.enrollment_confirmed'));
    assert.equal(JSON.stringify(f.audits).includes(started.secret), false);
    for (const code of confirmed.recoveryCodes)
      assert.equal(JSON.stringify(f.audits).includes(code), false);
  } finally {
    f.restore();
  }
});

test('recovery codes are consumed atomically and cannot be replayed', async () => {
  const f = fixture();
  try {
    const started = await f.service.startEnrollment(context);
    const confirmed = await f.service.confirmEnrollment(
      context,
      createTotpForTest(started.secret, new Date()),
    );
    const recoveryCode = confirmed.recoveryCodes[0]!;

    const verified = await f.service.verifyStepUp(context, {
      method: 'recovery',
      code: recoveryCode,
    });
    assert.equal(verified.method, 'recovery');
    assert.equal(f.recoveryCodes[0]?.consumedAt instanceof Date, true);
    assert.equal((await f.service.status(context)).recoveryCodesRemaining, 9);

    await assert.rejects(
      () => f.service.verifyStepUp(context, { method: 'recovery', code: recoveryCode }),
      (error: unknown) => error instanceof UnauthorizedException,
    );
    assert.equal(f.audits.filter((entry) => entry.action === 'mfa.recovery_code_used').length, 1);
  } finally {
    f.restore();
  }
});

test('failed factor checks are audited and lock the account after five attempts', async () => {
  const f = fixture();
  try {
    const started = await f.service.startEnrollment(context);
    await f.service.confirmEnrollment(context, createTotpForTest(started.secret, new Date()));
    const invalidCode = 'FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF';

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await assert.rejects(
        () => f.service.verifyStepUp(context, { method: 'recovery', code: invalidCode }),
        (error: unknown) => error instanceof UnauthorizedException,
      );
    }
    await assert.rejects(
      () => f.service.verifyStepUp(context, { method: 'recovery', code: invalidCode }),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
    );
    assert.equal(f.credential?.failedAttempts, 5);
    assert.ok((f.credential?.lockedUntil?.getTime() ?? 0) > Date.now());
    assert.equal(f.audits.filter((entry) => entry.action === 'mfa.step_up_denied').length, 5);
  } finally {
    f.restore();
  }
});

test('an expired pending enrollment cannot reset its active lockout', async () => {
  const f = fixture();
  try {
    await f.service.startEnrollment(context);
    const invalidCode = 'not-a-totp';
    for (let attempt = 1; attempt < 5; attempt += 1) {
      await assert.rejects(
        () => f.service.confirmEnrollment(context, invalidCode),
        (error: unknown) => error instanceof UnauthorizedException,
      );
    }
    await assert.rejects(
      () => f.service.confirmEnrollment(context, invalidCode),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
    );

    assert.ok(f.credential?.pendingExpiresAt);
    f.credential.pendingExpiresAt = new Date(Date.now() - 1);

    await assert.rejects(
      () => f.service.startEnrollment(context),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
    );
    assert.equal(f.credential?.failedAttempts, 5);
    assert.ok((f.credential?.lockedUntil?.getTime() ?? 0) > Date.now());
    assert.ok(
      f.audits.some(
        (entry) =>
          entry.action === 'mfa.enrollment_denied' &&
          (entry.details as { reason?: string } | undefined)?.reason === 'locked',
      ),
    );
  } finally {
    f.restore();
  }
});

test('regenerating recovery codes advances the factor version and revokes the prior set', async () => {
  const f = fixture();
  try {
    const started = await f.service.startEnrollment(context);
    const confirmed = await f.service.confirmEnrollment(
      context,
      createTotpForTest(started.secret, new Date()),
    );
    const regenerated = await f.service.regenerateRecoveryCodes(context, {
      method: 'totp',
      code: totpForNextStep(started.secret),
    });
    assert.equal(regenerated.factorVersion, confirmed.factorVersion + 1);
    assert.equal(regenerated.recoveryCodes.length, 10);
    assert.ok(f.recoveryCodes.slice(0, 10).every((code) => code.revokedAt instanceof Date));
    assert.equal((await f.service.status(context)).recoveryCodesRemaining, 10);
  } finally {
    f.restore();
  }
});
