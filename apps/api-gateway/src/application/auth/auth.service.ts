import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError, generateOpaqueSecret, hashSecret } from '@funtino/backend-core';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import {
  LocalOtpSender,
  OTP_SENDER,
  type OtpDeliveryStatus,
  type OtpSender,
} from '../../infrastructure/notifications/otp-sender.js';
import type { User } from '../../domain/models.js';
import { SESSION_TTL_MS, SYSTEM_ADMIN_MFA_LOGIN_WINDOW_MS } from './session-policy.js';
import { IdentityAccessClient } from '../../infrastructure/identity-access/identity-access.client.js';

export const SESSION_COOKIE = 'funtino_session';
const OTP_TTL_MS = 5 * 60 * 1000;

type AuthProfile = User & {
  avatarUrl: string | null;
  avatarUpdatedAt: string | null;
  profileCompleted: boolean;
};

@Injectable()
export class AuthService {
  private readonly lastOtpRequest = new Map<string, number>();

  constructor(
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
    private readonly identityAccess: IdentityAccessClient,
    @Optional() @Inject(OTP_SENDER) private readonly otpSender: OtpSender = new LocalOtpSender(),
  ) {}

  async requestOtp(rawPhone: string): Promise<{
    challengeId: string;
    expiresAt: string;
    deliveryStatus: OtpDeliveryStatus;
    devCode?: string;
  }> {
    const phoneE164 = normalizePhone(rawPhone);
    const lastRequest = this.lastOtpRequest.get(phoneE164) ?? 0;
    if (Date.now() - lastRequest < 30_000) {
      throw new DomainError('RATE_LIMITED', 'لطفاً چند ثانیه بعد دوباره تلاش کنید.');
    }
    this.lastOtpRequest.set(phoneE164, Date.now());

    const sent = await this.otpSender.sendOtp(phoneE164);
    const code = sent.code;
    const challenge = await this.store.saveOtpChallenge({ phoneE164, code, ttlMs: OTP_TTL_MS });
    return {
      challengeId: challenge.id,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      deliveryStatus: sent.deliveryStatus,
      ...(sent.provider === 'local' &&
      process.env.NODE_ENV !== 'production' &&
      process.env.EXPOSE_DEV_OTP === 'true'
        ? { devCode: code }
        : {}),
    };
  }

  async verifyOtp(input: {
    challengeId: string;
    phone: string;
    code: string;
    correlationId?: string;
  }): Promise<{
    token: string;
    user: AuthProfile;
    expiresAt: string;
    mfaRequired: boolean;
  }> {
    const phoneE164 = normalizePhone(input.phone);
    const challenge = await this.store.getOtpChallenge(input.challengeId);
    if (challenge.phoneE164 !== phoneE164) {
      throw new DomainError('VALIDATION_ERROR', 'کد ورود برای این شماره صادر نشده است.');
    }
    if (challenge.consumedAt || challenge.expiresAt <= Date.now()) {
      throw new DomainError('UNAUTHENTICATED', 'کد ورود منقضی شده است.');
    }
    if (challenge.attempts >= 5) {
      throw new DomainError('RATE_LIMITED', 'تعداد تلاش‌های ورود بیش از حد مجاز است.');
    }
    const attemptCount = await this.store.incrementOtpAttempt(challenge.id);
    if (attemptCount > 5) {
      throw new DomainError('RATE_LIMITED', 'OTP attempt limit exceeded.');
    }
    if (hashSecret(input.code) !== challenge.codeHash) {
      throw new DomainError('UNAUTHENTICATED', 'کد ورود نادرست است.');
    }
    const user = await this.store.createUser(phoneE164);
    const correlationId = input.correlationId ?? randomUUID();
    const access = await this.identityAccess.currentAccessContext(user.id, correlationId);
    const mfaRequired = access.memberships.some(
      (membership) =>
        membership.status === 'active' &&
        membership.scope.type === 'global' &&
        membership.role.status === 'active' &&
        membership.role.name === 'system_admin',
    );
    await this.store.consumeOtpChallenge(challenge.id);
    const token = generateOpaqueSecret(32);
    const mfaLoginDeadlineAt = mfaRequired ? Date.now() + SYSTEM_ADMIN_MFA_LOGIN_WINDOW_MS : null;
    const session = await this.store.saveSession(user.id, hashSecret(token), SESSION_TTL_MS, {
      isSystemAdmin: mfaRequired,
      mfaLoginDeadlineAt,
    });
    await this.store.recordAudit(
      user.id,
      'auth.session_created',
      'session',
      session.id,
      correlationId,
    );
    return {
      token,
      user: await this.presentUser(user),
      expiresAt: new Date(session.expiresAt).toISOString(),
      mfaRequired,
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.store.revokeSession(hashSecret(token));
  }

  async recordOperationsScopeSelection(
    userId: string,
    scope:
      | { type: 'organization'; organizationId: string }
      | { type: 'branch'; organizationId: string; branchId: string },
    correlationId: string,
  ): Promise<void> {
    const resourceId = scope.type === 'organization' ? scope.organizationId : scope.branchId;
    await this.store.recordAudit(
      userId,
      'operations.scope.selected',
      scope.type,
      resourceId,
      correlationId,
      null,
      {
        organizationId: scope.organizationId,
        branchId: scope.type === 'branch' ? scope.branchId : null,
      },
    );
  }

  async getMe(userId: string): Promise<AuthProfile> {
    return this.presentUser(await this.store.getUser(userId));
  }

  private async presentUser(user: User): Promise<AuthProfile> {
    const avatar = await this.store.getUserAvatar(user.id);
    return {
      ...user,
      avatarUrl: avatar ? '/api/v1/customer/profile/avatar' : null,
      avatarUpdatedAt: avatar?.updatedAt ?? null,
      profileCompleted: Boolean(user.profileCompletedAt),
    };
  }
}

export function normalizePhone(rawPhone: string): string {
  const value = rawPhone.replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(value)) return `+98${value.slice(1)}`;
  if (/^0098\d{10}$/.test(value)) return `+${value.slice(2)}`;
  if (/^\+[1-9]\d{7,14}$/.test(value)) return value;
  throw new DomainError('VALIDATION_ERROR', 'شماره موبایل معتبر نیست.');
}
