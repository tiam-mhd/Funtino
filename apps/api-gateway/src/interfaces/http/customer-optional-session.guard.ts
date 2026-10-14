import { CanActivate, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { hashSecret } from '@funtino/backend-core';
import { SESSION_COOKIE } from '../../application/auth/auth.service.js';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import type { Session } from '../../domain/models.js';

type OptionalCustomerRequest = FastifyRequest & {
  user?: { id: string };
  session?: Session;
};

@Injectable()
export class CustomerOptionalSessionGuard implements CanActivate {
  constructor(@Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OptionalCustomerRequest>();
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) return true;

    const session = await this.store.findSession(hashSecret(token));
    if (
      !session ||
      session.audience !== 'customer' ||
      session.revokedAt !== null ||
      session.expiresAt <= Date.now()
    ) {
      return true;
    }

    request.user = { id: session.userId };
    request.session = session;
    return true;
  }
}
