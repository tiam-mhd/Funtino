import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/index.js';
import { MfaCryptoService } from './mfa-crypto.service.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';
import { isEffectiveActiveMembership } from '../domain/authorization/bootstrap-membership.js';
import { MFA_STEP_UP_TTL_MS } from '../domain/authorization/mfa-policy.js';

const PENDING_ENROLLMENT_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export type MfaProof = { method: 'totp' | 'recovery'; code: string };
export type MfaContext = { actorUserId: string; sessionId: string; correlationId: string };

type AuditInput = MfaContext & {
  action: string;
  outcome: 'succeeded' | 'denied' | 'failed';
  reason?: string;
  beforeState?: Prisma.InputJsonObject;
  afterState?: Prisma.InputJsonObject;
  details?: Prisma.InputJsonObject;
};

type ProofResult =
  | { ok: true; method: 'totp' | 'recovery' }
  | { ok: false; reason: 'invalid' | 'locked' };

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MfaCryptoService,
  ) {}

  async status(context: MfaContext) {
    await this.requireActiveStaff(context.actorUserId);
    const credential = await this.prisma.mfaCredential.findUnique({
      where: { userId: context.actorUserId },
      select: { status: true, version: true, pendingExpiresAt: true },
    });
    const recoveryCodesRemaining =
      credential?.status === 'active'
        ? await this.prisma.mfaRecoveryCode.count({
            where: {
              userId: context.actorUserId,
              credentialVersion: credential.version,
              consumedAt: null,
              revokedAt: null,
            },
          })
        : 0;
    return {
      enabled: credential?.status === 'active',
      enrollmentPending:
        credential?.status === 'pending' &&
        credential.pendingExpiresAt !== null &&
        credential.pendingExpiresAt.getTime() > Date.now(),
      recoveryCodesRemaining,
    };
  }

  async startEnrollment(context: MfaContext) {
    await this.requireActiveStaff(context.actorUserId);
    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.mfaCredential.findUnique({
          where: { userId: context.actorUserId },
        });
        if (existing && this.isLocked(existing.lockedUntil, now)) {
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.enrollment_denied',
            outcome: 'denied',
            details: { reason: 'locked' },
          });
          return { ok: false as const, reason: 'locked' as const };
        }
        if (existing?.status === 'active') throw new ConflictException('MFA is already enabled.');
        if (
          existing?.status === 'pending' &&
          existing.pendingExpiresAt &&
          existing.pendingExpiresAt.getTime() > now.getTime()
        ) {
          const secret = this.decryptCredential(existing);
          return {
            ok: true as const,
            secret,
            otpauthUri: this.crypto.createOtpAuthUri(secret),
            expiresAt: existing.pendingExpiresAt.toISOString(),
          };
        }

        const secret = this.crypto.createTotpSecret();
        const encrypted = this.crypto.encryptSecret(secret);
        const nextVersion = (existing?.version ?? 0) + 1;
        const pendingExpiresAt = new Date(now.getTime() + PENDING_ENROLLMENT_MS);
        if (existing) {
          await tx.mfaRecoveryCode.updateMany({
            where: { userId: context.actorUserId, consumedAt: null, revokedAt: null },
            data: { revokedAt: now },
          });
          await tx.mfaCredential.update({
            where: { userId: context.actorUserId },
            data: {
              status: 'pending',
              secretCiphertext: encrypted.ciphertext,
              secretNonce: encrypted.nonce,
              secretAuthTag: encrypted.authTag,
              encryptionKeyVersion: encrypted.keyVersion,
              pendingExpiresAt,
              enabledAt: null,
              lastAcceptedStep: null,
              failedAttempts: 0,
              lockedUntil: null,
              version: nextVersion,
            },
          });
        } else {
          await tx.mfaCredential.create({
            data: {
              userId: context.actorUserId,
              status: 'pending',
              secretCiphertext: encrypted.ciphertext,
              secretNonce: encrypted.nonce,
              secretAuthTag: encrypted.authTag,
              encryptionKeyVersion: encrypted.keyVersion,
              pendingExpiresAt,
              version: nextVersion,
            },
          });
        }
        await this.writeAudit(tx, {
          ...context,
          action: 'mfa.enrollment_started',
          outcome: 'succeeded',
          beforeState: {
            status: existing?.status ?? 'not_enrolled',
            version: existing?.version ?? 0,
          },
          afterState: { status: 'pending', version: nextVersion },
          details: { status: 'pending', version: nextVersion },
        });
        return {
          ok: true as const,
          secret,
          otpauthUri: this.crypto.createOtpAuthUri(secret),
          expiresAt: pendingExpiresAt.toISOString(),
        };
      },
      { isolationLevel: 'Serializable', maxWait: 2_000, timeout: 5_000 },
    );
    if (!result.ok) this.throwProofError(result.reason);
    return {
      secret: result.secret,
      otpauthUri: result.otpauthUri,
      expiresAt: result.expiresAt,
    };
  }

  async confirmEnrollment(context: MfaContext, code: string) {
    await this.requireActiveStaff(context.actorUserId);
    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const credential = await tx.mfaCredential.findUnique({
          where: { userId: context.actorUserId },
        });
        if (
          !credential ||
          credential.status !== 'pending' ||
          !credential.pendingExpiresAt ||
          credential.pendingExpiresAt.getTime() <= now.getTime()
        ) {
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.enrollment_denied',
            outcome: 'denied',
            details: { reason: 'unavailable' },
          });
          return { ok: false as const, reason: 'invalid' as const };
        }
        if (this.isLocked(credential.lockedUntil, now)) {
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.enrollment_denied',
            outcome: 'denied',
            details: { reason: 'locked' },
          });
          return { ok: false as const, reason: 'locked' as const };
        }

        const secret = this.decryptCredential(credential);
        const step = this.crypto.matchingTotpStep(secret, code, now, credential.lastAcceptedStep);
        if (step === null) {
          const locked = await this.recordFailure(tx, credential.userId, now);
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.enrollment_denied',
            outcome: 'denied',
            details: { reason: locked ? 'locked' : 'invalid' },
          });
          return {
            ok: false as const,
            reason: locked ? ('locked' as const) : ('invalid' as const),
          };
        }

        const version = credential.version + 1;
        const changed = await tx.mfaCredential.updateMany({
          where: {
            userId: context.actorUserId,
            status: 'pending',
            version: credential.version,
            pendingExpiresAt: { gt: now },
            OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: BigInt(step) } }],
          },
          data: {
            status: 'active',
            pendingExpiresAt: null,
            enabledAt: now,
            lastAcceptedStep: BigInt(step),
            failedAttempts: 0,
            lockedUntil: null,
            version,
          },
        });
        if (changed.count !== 1) {
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.enrollment_denied',
            outcome: 'denied',
            details: { reason: 'replayed_or_changed' },
          });
          return { ok: false as const, reason: 'invalid' as const };
        }

        const recoveryCodes = this.crypto.createRecoveryCodes();
        await tx.mfaRecoveryCode.createMany({
          data: recoveryCodes.map((recoveryCode) => ({
            id: randomUUID(),
            userId: context.actorUserId,
            credentialVersion: version,
            codeHash: this.crypto.hashRecoveryCode(recoveryCode)!,
          })),
        });
        await this.writeAudit(tx, {
          ...context,
          action: 'mfa.enrollment_confirmed',
          outcome: 'succeeded',
          beforeState: { status: 'pending', version: credential.version },
          afterState: { status: 'active', version, recoveryCodesRemaining: recoveryCodes.length },
          details: { status: 'active', version, recoveryCodeCount: recoveryCodes.length },
        });
        return {
          ok: true as const,
          recoveryCodes,
          factorVersion: version,
          verifiedAt: now.toISOString(),
        };
      },
      { isolationLevel: 'Serializable', maxWait: 2_000, timeout: 5_000 },
    );

    if (!result.ok) this.throwProofError(result.reason);
    return {
      recoveryCodes: result.recoveryCodes,
      factorVersion: result.factorVersion,
      method: 'totp' as const,
      verifiedAt: result.verifiedAt,
      validUntil: new Date(new Date(result.verifiedAt).getTime() + MFA_STEP_UP_TTL_MS).toISOString(),
    };
  }

  async verifyStepUp(context: MfaContext, proof: MfaProof) {
    await this.requireActiveStaff(context.actorUserId);
    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const credential = await tx.mfaCredential.findUnique({
          where: { userId: context.actorUserId },
        });
        if (!credential || credential.status !== 'active') {
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.step_up_denied',
            outcome: 'denied',
            details: { reason: 'unavailable' },
          });
          return { ok: false as const, reason: 'invalid' as const };
        }
        const consumed = await this.consumeProof(tx, context.actorUserId, credential, proof, now);
        if (!consumed.ok) {
          const locked =
            consumed.reason === 'locked' ||
            (await this.recordFailure(tx, context.actorUserId, now));
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.step_up_denied',
            outcome: 'denied',
            details: { reason: locked ? 'locked' : 'invalid' },
          });
          return {
            ok: false as const,
            reason: locked ? ('locked' as const) : ('invalid' as const),
          };
        }
        await tx.mfaCredential.update({
          where: { userId: context.actorUserId },
          data: { failedAttempts: 0, lockedUntil: null },
        });
        await this.writeAudit(tx, {
          ...context,
          action:
            consumed.method === 'recovery' ? 'mfa.recovery_code_used' : 'mfa.step_up_succeeded',
          outcome: 'succeeded',
          beforeState: { status: 'active', version: credential.version },
          afterState: {
            status: 'active',
            version: credential.version,
            recoveryCodesRemaining: await tx.mfaRecoveryCode.count({
              where: {
                userId: context.actorUserId,
                credentialVersion: credential.version,
                consumedAt: null,
                revokedAt: null,
              },
            }),
          },
          details: { method: consumed.method, factorVersion: credential.version },
        });
        return {
          ok: true as const,
          method: consumed.method,
          factorVersion: credential.version,
          verifiedAt: now.toISOString(),
        };
      },
      { isolationLevel: 'Serializable', maxWait: 2_000, timeout: 5_000 },
    );
    if (!result.ok) this.throwProofError(result.reason);
    return {
      method: result.method,
      factorVersion: result.factorVersion,
      verifiedAt: result.verifiedAt,
      validUntil: new Date(new Date(result.verifiedAt).getTime() + MFA_STEP_UP_TTL_MS).toISOString(),
    };
  }

  async regenerateRecoveryCodes(context: MfaContext, proof: MfaProof) {
    await this.requireActiveStaff(context.actorUserId);
    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const credential = await tx.mfaCredential.findUnique({
          where: { userId: context.actorUserId },
        });
        if (!credential || credential.status !== 'active') {
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.recovery_codes_denied',
            outcome: 'denied',
            details: { reason: 'unavailable' },
          });
          return { ok: false as const, reason: 'invalid' as const };
        }
        const consumed = await this.consumeProof(tx, context.actorUserId, credential, proof, now);
        if (!consumed.ok) {
          const locked =
            consumed.reason === 'locked' ||
            (await this.recordFailure(tx, context.actorUserId, now));
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.recovery_codes_denied',
            outcome: 'denied',
            details: { reason: locked ? 'locked' : 'invalid' },
          });
          return {
            ok: false as const,
            reason: locked ? ('locked' as const) : ('invalid' as const),
          };
        }
        const version = credential.version + 1;
        await tx.mfaRecoveryCode.updateMany({
          where: { userId: context.actorUserId, consumedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.mfaCredential.update({
          where: { userId: context.actorUserId },
          data: { version, failedAttempts: 0, lockedUntil: null },
        });
        const recoveryCodes = this.crypto.createRecoveryCodes();
        await tx.mfaRecoveryCode.createMany({
          data: recoveryCodes.map((recoveryCode) => ({
            id: randomUUID(),
            userId: context.actorUserId,
            credentialVersion: version,
            codeHash: this.crypto.hashRecoveryCode(recoveryCode)!,
          })),
        });
        await this.writeAudit(tx, {
          ...context,
          action: 'mfa.recovery_codes_regenerated',
          outcome: 'succeeded',
          beforeState: { status: 'active', version: credential.version },
          afterState: { status: 'active', version, recoveryCodesRemaining: recoveryCodes.length },
          details: {
            method: consumed.method,
            previousVersion: credential.version,
            version,
            recoveryCodeCount: recoveryCodes.length,
          },
        });
        return {
          ok: true as const,
          recoveryCodes,
          method: consumed.method,
          factorVersion: version,
          verifiedAt: now.toISOString(),
        };
      },
      { isolationLevel: 'Serializable', maxWait: 2_000, timeout: 5_000 },
    );
    if (!result.ok) this.throwProofError(result.reason);
    return {
      recoveryCodes: result.recoveryCodes,
      method: result.method,
      factorVersion: result.factorVersion,
      verifiedAt: result.verifiedAt,
      validUntil: new Date(new Date(result.verifiedAt).getTime() + MFA_STEP_UP_TTL_MS).toISOString(),
    };
  }

  async disable(context: MfaContext, proof: MfaProof) {
    await this.requireActiveStaff(context.actorUserId);
    const now = new Date();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const credential = await tx.mfaCredential.findUnique({
          where: { userId: context.actorUserId },
        });
        if (!credential || credential.status !== 'active') {
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.disable_denied',
            outcome: 'denied',
            details: { reason: 'unavailable' },
          });
          return { ok: false as const, reason: 'invalid' as const };
        }
        const consumed = await this.consumeProof(tx, context.actorUserId, credential, proof, now);
        if (!consumed.ok) {
          const locked =
            consumed.reason === 'locked' ||
            (await this.recordFailure(tx, context.actorUserId, now));
          await this.writeAudit(tx, {
            ...context,
            action: 'mfa.disable_denied',
            outcome: 'denied',
            details: { reason: locked ? 'locked' : 'invalid' },
          });
          return {
            ok: false as const,
            reason: locked ? ('locked' as const) : ('invalid' as const),
          };
        }
        const version = credential.version + 1;
        await tx.mfaRecoveryCode.updateMany({
          where: { userId: context.actorUserId, consumedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.mfaCredential.update({
          where: { userId: context.actorUserId },
          data: {
            status: 'disabled',
            pendingExpiresAt: null,
            enabledAt: null,
            failedAttempts: 0,
            lockedUntil: null,
            version,
          },
        });
        await this.writeAudit(tx, {
          ...context,
          action: 'mfa.disabled',
          outcome: 'succeeded',
          beforeState: { status: 'active', version: credential.version },
          afterState: { status: 'disabled', version, recoveryCodesRemaining: 0 },
          details: { method: consumed.method, previousVersion: credential.version, version },
        });
        return { ok: true as const };
      },
      { isolationLevel: 'Serializable', maxWait: 2_000, timeout: 5_000 },
    );
    if (!result.ok) this.throwProofError(result.reason);
    return { enabled: false };
  }

  private async consumeProof(
    tx: Prisma.TransactionClient,
    userId: string,
    credential: {
      status: string;
      version: number;
      secretCiphertext: Uint8Array;
      secretNonce: Uint8Array;
      secretAuthTag: Uint8Array;
      encryptionKeyVersion: string;
      lastAcceptedStep: bigint | null;
      lockedUntil: Date | null;
    },
    proof: MfaProof,
    now: Date,
  ): Promise<ProofResult> {
    if (this.isLocked(credential.lockedUntil, now)) return { ok: false, reason: 'locked' };
    if (proof.method === 'totp') {
      const secret = this.decryptCredential(credential);
      const step = this.crypto.matchingTotpStep(
        secret,
        proof.code,
        now,
        credential.lastAcceptedStep,
      );
      if (step === null) return { ok: false, reason: 'invalid' };
      const updated = await tx.mfaCredential.updateMany({
        where: {
          userId,
          status: 'active',
          version: credential.version,
          OR: [{ lastAcceptedStep: null }, { lastAcceptedStep: { lt: BigInt(step) } }],
        },
        data: { lastAcceptedStep: BigInt(step), failedAttempts: 0, lockedUntil: null },
      });
      return updated.count === 1 ? { ok: true, method: 'totp' } : { ok: false, reason: 'invalid' };
    }

    const codeHash = this.crypto.hashRecoveryCode(proof.code);
    if (!codeHash) return { ok: false, reason: 'invalid' };
    const consumed = await tx.mfaRecoveryCode.updateMany({
      where: {
        userId,
        credentialVersion: credential.version,
        codeHash,
        consumedAt: null,
        revokedAt: null,
      },
      data: { consumedAt: now },
    });
    return consumed.count === 1
      ? { ok: true, method: 'recovery' }
      : { ok: false, reason: 'invalid' };
  }

  private async recordFailure(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const updated = await tx.mfaCredential.update({
      where: { userId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    const locked = updated.failedAttempts >= MAX_FAILED_ATTEMPTS;
    if (locked) {
      await tx.mfaCredential.update({
        where: { userId },
        data: { lockedUntil: new Date(now.getTime() + LOCKOUT_MS) },
      });
    }
    return locked;
  }

  private decryptCredential(credential: {
    secretCiphertext: Uint8Array;
    secretNonce: Uint8Array;
    secretAuthTag: Uint8Array;
    encryptionKeyVersion: string;
  }): string {
    return this.crypto.decryptSecret({
      ciphertext: credential.secretCiphertext,
      nonce: credential.secretNonce,
      authTag: credential.secretAuthTag,
      keyVersion: credential.encryptionKeyVersion,
    });
  }

  private isLocked(lockedUntil: Date | null, now: Date): boolean {
    return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
  }

  private async requireActiveStaff(userId: string): Promise<void> {
    const memberships = await this.prisma.staffMembership.findMany({
      where: { userId, status: 'active' },
      select: { status: true, createdAt: true, role: { select: { name: true } } },
    });
    const hasEffectiveMembership = memberships.some((membership) =>
      isEffectiveActiveMembership({
        status: membership.status,
        createdAt: membership.createdAt,
        roleName: membership.role.name,
      }),
    );
    if (!hasEffectiveMembership) throw new ForbiddenException('Active staff membership is required.');
  }

  private async writeAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
    await tx.mfaAuditLog.create({
      data: {
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        action: input.action,
        reason: input.reason ?? input.action,
        outcome: input.outcome,
        correlationId: input.correlationId,
        ...(input.beforeState ? { beforeState: input.beforeState } : {}),
        ...(input.afterState ? { afterState: input.afterState } : {}),
        ...(input.details ? { details: input.details } : {}),
      },
    });
  }

  private throwProofError(reason: 'invalid' | 'locked'): never {
    if (reason === 'locked') {
      throw new HttpException(
        'MFA verification is temporarily locked.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw new UnauthorizedException('MFA verification failed.');
  }
}
