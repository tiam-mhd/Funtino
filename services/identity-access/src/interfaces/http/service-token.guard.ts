import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

export function isServiceTokenValid(configured: string | undefined, supplied: unknown): boolean {
  if (
    !configured ||
    configured.length < 32 ||
    configured.length > 512 ||
    typeof supplied !== 'string' ||
    supplied.length < 32 ||
    supplied.length > 512
  ) {
    return false;
  }
  const configuredDigest = createHash('sha256').update(configured).digest();
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(configuredDigest, suppliedDigest);
}

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
    if (!configured || configured.length < 32) {
      throw new ServiceUnavailableException({
        status: 'error',
        error: {
          code: 'SERVICE_AUTH_NOT_CONFIGURED',
          message: 'Service authentication is unavailable.',
        },
      });
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isServiceTokenValid(configured, request.headers['x-funtino-service-token'])) {
      throw new UnauthorizedException({
        status: 'error',
        error: { code: 'UNAUTHENTICATED', message: 'Invalid service credential.' },
      });
    }
    return true;
  }
}
