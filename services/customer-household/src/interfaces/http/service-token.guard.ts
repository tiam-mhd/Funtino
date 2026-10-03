import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

const callers = {
  'api-gateway': 'CUSTOMER_HOUSEHOLD_GATEWAY_TOKEN',
  wallet: 'CUSTOMER_HOUSEHOLD_WALLET_TOKEN',
} as const;
const walletRoute = '/internal/v1/households/:householdId/validation';

function sameSecret(configured: string | undefined, supplied: unknown): boolean {
  if (!configured || configured.length < 32 || typeof supplied !== 'string') return false;
  if (supplied.length < 32 || supplied.length > 512 || configured.length > 512) return false;
  return timingSafeEqual(
    createHash('sha256').update(configured).digest(),
    createHash('sha256').update(supplied).digest(),
  );
}

@Injectable()
export class CustomerHouseholdServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const caller = request.headers['x-funtino-service-id'];
    const token = request.headers['x-funtino-service-token'];
    if (typeof caller !== 'string' || !Object.hasOwn(callers, caller)) {
      throw new UnauthorizedException('Invalid service identity.');
    }
    if (
      (caller === 'wallet' &&
        (request.method !== 'GET' || request.routeOptions.url !== walletRoute)) ||
      (caller === 'api-gateway' && request.routeOptions.url === walletRoute)
    ) {
      throw new UnauthorizedException('This service is not allowed to call this endpoint.');
    }
    const envName = callers[caller as keyof typeof callers];
    const configured = process.env[envName];
    if (!configured || configured.length < 32 || configured.length > 512) {
      throw new ServiceUnavailableException('Service authentication is not configured.');
    }
    if (!sameSecret(configured, token))
      throw new UnauthorizedException('Invalid service credential.');
    return true;
  }
}
