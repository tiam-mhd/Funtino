import { CanActivate, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { hashSecret, DomainError } from '@funtino/backend-core';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import type { Session } from '../../domain/models.js';
import { SYSTEM_ADMIN_IDLE_TIMEOUT_MS } from '../../application/auth/session-policy.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: { id: string }; session?: Session }>();
    const token = request.cookies?.funtino_session;
    if (!token) throw new DomainError('UNAUTHENTICATED', 'برای ادامه وارد حساب شوید.');
    const session = await this.store.findSession(hashSecret(token));
    if (!session) throw new DomainError('UNAUTHENTICATED', 'نشست شما منقضی شده است.');
    if (session.isSystemAdmin) {
      const now = Date.now();
      if (now - session.lastActivityAt >= SYSTEM_ADMIN_IDLE_TIMEOUT_MS) {
        await this.store.revokeSession(session.tokenHash);
        throw new DomainError('UNAUTHENTICATED', 'نشست مدیر به‌دلیل بی‌فعالیتی منقضی شد.');
      }
      if (
        session.mfaVerifiedAt === null &&
        (!session.mfaLoginDeadlineAt || session.mfaLoginDeadlineAt <= now)
      ) {
        await this.store.revokeSession(session.tokenHash);
        throw new DomainError('UNAUTHENTICATED', 'مهلت تأیید دومرحله‌ای پایان یافته است.');
      }
      if (session.mfaVerifiedAt === null && !isMfaLoginPath(request.method, request.url)) {
        throw new DomainError('FORBIDDEN', 'برای ادامه‌ی ورود مدیر سامانه، MFA را تکمیل کنید.');
      }
      await this.store.touchSessionActivity(session.id, now);
    }
    request.user = { id: session.userId };
    request.session = session;
    return true;
  }
}

function isMfaLoginPath(method: string, requestUrl: string): boolean {
  const path = requestUrl.split('?', 1)[0];
  if (method === 'GET' && path === '/api/v1/operations/mfa/status') return true;
  return (
    method === 'POST' &&
    [
      '/api/v1/operations/mfa/enrollment/start',
      '/api/v1/operations/mfa/enrollment/confirm',
      '/api/v1/operations/mfa/step-up/verify',
    ].includes(path)
  );
}
