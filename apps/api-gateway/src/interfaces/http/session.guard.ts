import { CanActivate, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { hashSecret, DomainError } from '@funtino/backend-core';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import type { Session } from '../../domain/models.js';
import { MANAGEMENT_SESSION_COOKIE, SESSION_COOKIE } from '../../application/auth/auth.service.js';
import { SYSTEM_ADMIN_IDLE_TIMEOUT_MS } from '../../application/auth/session-policy.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: { id: string }; session?: Session }>();
    const audience = expectedAudience(request.method, request.url);
    const cookieName = audience === 'customer' ? SESSION_COOKIE : MANAGEMENT_SESSION_COOKIE;
    const token = request.cookies?.[cookieName];
    if (!token) throw new DomainError('UNAUTHENTICATED', 'برای ادامه وارد حساب شوید.');
    const session = await this.store.findSession(hashSecret(token));
    if (!session || session.audience !== audience) {
      throw new DomainError('UNAUTHENTICATED', 'نشست شما معتبر نیست یا منقضی شده است.');
    }
    const now = Date.now();
    if (audience === 'management') {
      if (now - session.lastActivityAt >= SYSTEM_ADMIN_IDLE_TIMEOUT_MS) {
        await this.store.revokeSession(session.tokenHash);
        throw new DomainError('UNAUTHENTICATED', 'نشست مدیریتی به‌دلیل بی‌فعالیتی منقضی شد.');
      }
      await this.store.touchSessionActivity(session.id, now);
    }
    request.user = { id: session.userId };
    request.session = session;
    return true;
  }
}

function expectedAudience(method: string, requestUrl: string): 'customer' | 'management' {
  const path = requestUrl.split('?', 1)[0];
  if (
    (method === 'GET' && path === '/api/v1/auth/me') ||
    path === '/api/v1/customer' ||
    path.startsWith('/api/v1/customer/')
  ) {
    return 'customer';
  }
  if (
    path.startsWith('/api/v1/operations/') ||
    path.startsWith('/api/v1/system/') ||
    path.startsWith('/api/v1/auth/management/')
  ) {
    return 'management';
  }
  throw new DomainError('FORBIDDEN', 'مسیر درخواست نشست معتبری نمی‌پذیرد.');
}
