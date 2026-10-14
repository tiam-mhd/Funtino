import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { DomainError, generateOpaqueSecret, hashSecret } from '@funtino/backend-core';
import {
  FUNTINO_STORE,
  type FuntinoStorePort,
  type OtpPurpose,
} from '../../infrastructure/store/funtino-store.js';
import {
  LocalOtpSender,
  OTP_SENDER,
  type OtpDeliveryStatus,
  type OtpSender,
} from '../../infrastructure/notifications/otp-sender.js';
import type { ManagementPasswordState, User, UserIdentitySummary } from '../../domain/models.js';
import { SESSION_TTL_MS } from './session-policy.js';
import {
  IdentityAccessClient,
  type OperationsAccessContext,
} from '../../infrastructure/identity-access/identity-access.client.js';

export const SESSION_COOKIE = 'funtino_session';
export const MANAGEMENT_SESSION_COOKIE = 'funtino_management_session';
export const MANAGEMENT_LOGIN_CHALLENGE_COOKIE = 'funtino_management_challenge';
const OTP_TTL_MS = 5 * 60 * 1000;
const MANAGEMENT_LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const OTP_REQUEST_COOLDOWN_MS = 30_000;
const PASSWORD_MAX_ATTEMPTS = 5;
const PASSWORD_LOCKOUT_MS = 15 * 60 * 1000;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 64;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

type AuthProfile = User & {
  avatarUrl: string | null;
  avatarUpdatedAt: string | null;
  profileCompleted: boolean;
};

type ManagementLoginResult = {
  requiresPassword: boolean;
  challengeToken?: string;
  token?: string;
  expiresAt: string;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
    private readonly identityAccess: IdentityAccessClient,
    @Optional() @Inject(OTP_SENDER) private readonly otpSender: OtpSender = new LocalOtpSender(),
  ) {}

  async requestOtp(
    rawPhone: string,
    purpose: OtpPurpose = 'customer_login',
  ): Promise<{
    challengeId: string;
    expiresAt: string;
    deliveryStatus: OtpDeliveryStatus;
    devCode?: string;
  }> {
    const phoneE164 = normalizePhone(rawPhone);
    const throttleKey = hashSecret(`otp:${purpose}:${phoneE164}`);
    const now = Date.now();
    if (!(await this.store.consumeOtpRequestCooldown(throttleKey, now, OTP_REQUEST_COOLDOWN_MS))) {
      throw new DomainError('RATE_LIMITED', 'لطفاً چند ثانیه بعد دوباره تلاش کنید.');
    }

    const sent = await this.otpSender.sendOtp(phoneE164);
    const challenge = await this.store.saveOtpChallenge({
      phoneE164,
      code: sent.code,
      ttlMs: OTP_TTL_MS,
      purpose,
    });
    return {
      challengeId: challenge.id,
      expiresAt: new Date(challenge.expiresAt).toISOString(),
      deliveryStatus: sent.deliveryStatus,
      ...(sent.provider === 'local' &&
      process.env.NODE_ENV !== 'production' &&
      process.env.EXPOSE_DEV_OTP === 'true'
        ? { devCode: sent.code }
        : {}),
    };
  }

  async verifyOtp(input: {
    challengeId: string;
    phone: string;
    code: string;
    correlationId?: string;
  }): Promise<{ token: string; user: AuthProfile; expiresAt: string }> {
    const phoneE164 = normalizePhone(input.phone);
    await this.consumeOtp({
      challengeId: input.challengeId,
      phoneE164,
      code: input.code,
      purpose: 'customer_login',
    });
    const user = await this.store.createUser(phoneE164);
    const correlationId = input.correlationId ?? randomUUID();
    const token = generateOpaqueSecret(32);
    const session = await this.store.saveSession(user.id, hashSecret(token), SESSION_TTL_MS, {
      audience: 'customer',
    });
    await this.store.recordAudit(
      user.id,
      'auth.customer_session_created',
      'session',
      session.id,
      correlationId,
    );
    return {
      token,
      user: await this.presentUser(user),
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  async verifyManagementOtp(input: {
    challengeId: string;
    phone: string;
    code: string;
    correlationId?: string;
  }): Promise<ManagementLoginResult> {
    const phoneE164 = normalizePhone(input.phone);
    await this.consumeOtp({
      challengeId: input.challengeId,
      phoneE164,
      code: input.code,
      purpose: 'management_login',
    });
    const user = await this.store.getUserByPhone(phoneE164);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'شماره یا کد ورود معتبر نیست.');
    const access = await this.requireManagementAccess(user.id, input.correlationId);
    const password = await this.store.getManagementPasswordState(user.id);
    if (password.passwordHash) {
      const challengeToken = generateOpaqueSecret(32);
      const challenge = await this.store.saveManagementLoginChallenge(
        user.id,
        hashSecret(challengeToken),
        MANAGEMENT_LOGIN_CHALLENGE_TTL_MS,
      );
      return {
        requiresPassword: true,
        challengeToken,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
      };
    }
    return this.createManagementSession(user, access, input.correlationId);
  }

  async verifyManagementPassword(input: {
    challengeToken: string;
    password: string;
    correlationId?: string;
  }): Promise<{ token: string; expiresAt: string }> {
    const challengeHash = hashSecret(input.challengeToken);
    const challenge = await this.store.findManagementLoginChallenge(challengeHash);
    if (!challenge || challenge.consumedAt !== null || challenge.expiresAt <= Date.now()) {
      throw new DomainError(
        'UNAUTHENTICATED',
        'درخواست ورود معتبر نیست یا مهلت آن پایان یافته است.',
      );
    }
    const state = await this.store.getManagementPasswordState(challenge.userId);
    this.assertNotLocked(state, Date.now());
    if (!state.passwordHash) {
      await this.store.consumeManagementLoginChallenge(challengeHash, Date.now());
      throw new DomainError('UNAUTHENTICATED', 'درخواست ورود معتبر نیست.');
    }
    const valid = await verifyManagementPassword(input.password, state.passwordHash);
    if (!valid) {
      const now = Date.now();
      await this.store.incrementManagementLoginChallengeAttempt(
        challengeHash,
        now,
        PASSWORD_MAX_ATTEMPTS,
      );
      const latest = await this.store.recordManagementPasswordFailure(
        challenge.userId,
        now,
        PASSWORD_MAX_ATTEMPTS,
        PASSWORD_LOCKOUT_MS,
      );
      if (latest.lockedUntil && latest.lockedUntil > now) {
        throw new DomainError('RATE_LIMITED', 'به‌دلیل تلاش‌های ناموفق، ورود موقتاً قفل شده است.');
      }
      throw new DomainError('UNAUTHENTICATED', 'رمز عبور نادرست است.');
    }

    const correlationId = input.correlationId ?? randomUUID();
    const access = await this.requireManagementAccess(challenge.userId, correlationId);
    if (!(await this.store.consumeManagementLoginChallenge(challengeHash, Date.now()))) {
      throw new DomainError('UNAUTHENTICATED', 'درخواست ورود قبلاً استفاده شده یا منقضی شده است.');
    }
    await this.store.clearManagementPasswordFailures(challenge.userId);
    const user = await this.store.getUser(challenge.userId);
    const result = await this.createManagementSession(user, access, correlationId);
    return { token: result.token!, expiresAt: result.expiresAt };
  }

  async requestManagementPasswordOtp(userId: string): Promise<{
    challengeId: string;
    expiresAt: string;
    deliveryStatus: OtpDeliveryStatus;
    devCode?: string;
  }> {
    const user = await this.store.getUser(userId);
    return this.requestOtp(user.phoneE164, 'management_password');
  }

  async getManagementPasswordStatus(userId: string): Promise<{ enabled: boolean }> {
    const state = await this.store.getManagementPasswordState(userId);
    return { enabled: Boolean(state.passwordHash) };
  }

  async updateManagementPassword(input: {
    userId: string;
    sessionId: string;
    enabled: boolean;
    challengeId: string;
    code: string;
    password?: string;
    currentPassword?: string;
    correlationId?: string;
  }): Promise<{ enabled: boolean }> {
    const correlationId = input.correlationId ?? randomUUID();
    await this.requireManagementAccess(input.userId, correlationId);
    const state = await this.store.getManagementPasswordState(input.userId);
    this.assertNotLocked(state, Date.now());
    if (state.passwordHash) {
      if (
        !input.currentPassword ||
        !(await verifyManagementPassword(input.currentPassword, state.passwordHash))
      ) {
        const now = Date.now();
        const latest = await this.store.recordManagementPasswordFailure(
          input.userId,
          now,
          PASSWORD_MAX_ATTEMPTS,
          PASSWORD_LOCKOUT_MS,
        );
        if (latest.lockedUntil && latest.lockedUntil > now) {
          throw new DomainError(
            'RATE_LIMITED',
            'به‌دلیل تلاش‌های ناموفق، تغییر رمز موقتاً قفل شده است.',
          );
        }
        throw new DomainError('UNAUTHENTICATED', 'رمز عبور فعلی نادرست است.');
      }
    }

    let passwordHash: string | null = null;
    if (input.enabled) {
      if (
        input.password !== undefined &&
        (input.password.length < 12 || input.password.length > 128)
      ) {
        throw new DomainError('VALIDATION_ERROR', 'رمز عبور باید بین ۱۲ تا ۱۲۸ نویسه باشد.');
      }
      if (input.password !== undefined) {
        passwordHash = await hashManagementPassword(input.password);
      } else if (state.passwordHash) {
        passwordHash = state.passwordHash;
      } else {
        throw new DomainError('VALIDATION_ERROR', 'برای فعال‌سازی رمز مدیریت، رمز تازه وارد کنید.');
      }
    }
    const user = await this.store.getUser(input.userId);
    await this.consumeOtp({
      challengeId: input.challengeId,
      phoneE164: user.phoneE164,
      code: input.code,
      purpose: 'management_password',
    });
    await this.store.setManagementPassword(input.userId, passwordHash, input.sessionId);
    const action = !input.enabled
      ? 'auth.management_password.disabled'
      : state.passwordHash
        ? 'auth.management_password.changed'
        : 'auth.management_password.enabled';
    await this.store.recordAudit(input.userId, action, 'user', input.userId, correlationId);
    return { enabled: input.enabled };
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

  async getUserIdentitySummaries(userIds: readonly string[]): Promise<UserIdentitySummary[]> {
    return this.store.listUserIdentitySummaries([...new Set(userIds)].slice(0, 100));
  }

  private async consumeOtp(input: {
    challengeId: string;
    phoneE164: string;
    code: string;
    purpose: OtpPurpose;
  }): Promise<void> {
    const result = await this.store.consumeOtpChallengeIfValid({
      challengeId: input.challengeId,
      phoneE164: input.phoneE164,
      purpose: input.purpose,
      codeHash: hashSecret(input.code),
      now: Date.now(),
    });
    switch (result.status) {
      case 'verified':
        return;
      case 'rate_limited':
        throw new DomainError('RATE_LIMITED', 'تعداد تلاش‌های ورود بیش از حد مجاز است.');
      case 'not_found':
        throw new DomainError('NOT_FOUND', 'درخواست ورود پیدا نشد.');
      case 'phone_mismatch':
      case 'purpose_mismatch':
        throw new DomainError('VALIDATION_ERROR', 'کد برای این درخواست معتبر نیست.');
      case 'expired':
      case 'consumed':
        throw new DomainError('UNAUTHENTICATED', 'کد ورود منقضی شده یا قبلاً استفاده شده است.');
      case 'invalid_code':
        throw new DomainError('UNAUTHENTICATED', 'کد ورود نادرست است.');
    }
  }

  private async requireManagementAccess(
    userId: string,
    correlationId?: string,
  ): Promise<OperationsAccessContext> {
    const access = await this.identityAccess.currentAccessContext(
      userId,
      correlationId ?? randomUUID(),
    );
    const active = access.memberships.some(
      (membership) => membership.status === 'active' && membership.role.status === 'active',
    );
    if (!active) throw new DomainError('UNAUTHENTICATED', 'حساب دسترسی مدیریتی فعالی ندارد.');
    return access;
  }

  private async createManagementSession(
    user: User,
    access: OperationsAccessContext,
    correlationId?: string,
  ): Promise<ManagementLoginResult> {
    const token = generateOpaqueSecret(32);
    const sessionTtlMs = access.managementSessionTtlHours * 60 * 60 * 1000;
    const session = await this.store.saveSession(user.id, hashSecret(token), sessionTtlMs, {
      audience: 'management',
    });
    await this.store.recordAudit(
      user.id,
      'auth.management_session_created',
      'session',
      session.id,
      correlationId ?? randomUUID(),
    );
    return { requiresPassword: false, token, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  private assertNotLocked(state: ManagementPasswordState, now: number): void {
    if (state.lockedUntil !== null && state.lockedUntil > now) {
      throw new DomainError('RATE_LIMITED', 'به‌دلیل تلاش‌های ناموفق، ورود موقتاً قفل شده است.');
    }
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

async function hashManagementPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derivePasswordKey(password, salt);
  return `scrypt-v1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyManagementPassword(password: string, encoded: string): Promise<boolean> {
  const [version, saltText, expectedText, extra] = encoded.split('$');
  if (version !== 'scrypt-v1' || !saltText || !expectedText || extra !== undefined) return false;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(expectedText, 'base64url');
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_BYTES) return false;
    const actual = await derivePasswordKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}
