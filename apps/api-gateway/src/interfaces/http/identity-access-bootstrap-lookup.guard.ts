import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

const LOOKUP_TOKEN_ENV = 'SYSTEM_ADMIN_BOOTSTRAP_LOOKUP_TOKEN';
const TOKEN_HEADER = 'x-funtino-service-token';
const SERVICE_ID_HEADER = 'x-funtino-service-id';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isValidLookupToken(configured: string | undefined, supplied: unknown): boolean {
  if (
    !configured ||
    configured.length < 32 ||
    configured.length > 512 ||
    typeof supplied !== 'string' ||
    supplied.length < 32 ||
    supplied.length > 512
  )
    return false;
  const configuredDigest = createHash('sha256').update(configured).digest();
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(configuredDigest, suppliedDigest);
}

@Injectable()
export class IdentityAccessBootstrapLookupGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = process.env[LOOKUP_TOKEN_ENV];
    if (!configured || configured.length < 32) {
      throw new ServiceUnavailableException({
        status: 'error',
        error: {
          code: 'SYSTEM_ADMIN_BOOTSTRAP_LOOKUP_NOT_CONFIGURED',
          message: 'System-owner bootstrap lookup is unavailable.',
        },
      });
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const remoteAddress = request.raw.socket.remoteAddress;
    if (
      !LOOPBACK_ADDRESSES.has(remoteAddress ?? '') ||
      request.headers[SERVICE_ID_HEADER] !== 'identity-access' ||
      !isValidLookupToken(configured, request.headers[TOKEN_HEADER])
    ) {
      throw new UnauthorizedException({
        status: 'error',
        error: { code: 'UNAUTHENTICATED', message: 'Invalid internal service credential.' },
      });
    }
    return true;
  }
}
