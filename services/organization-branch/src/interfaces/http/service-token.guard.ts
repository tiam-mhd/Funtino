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
  'api-gateway': 'ORGANIZATION_BRANCH_GATEWAY_TOKEN',
  'identity-access': 'ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN',
  'device-integration': 'ORGANIZATION_BRANCH_DEVICE_INTEGRATION_TOKEN',
  wallet: 'ORGANIZATION_BRANCH_WALLET_TOKEN',
} as const;

function sameSecret(configured: string | undefined, supplied: unknown): boolean {
  if (!configured || configured.length < 32 || typeof supplied !== 'string') return false;
  if (supplied.length < 32 || supplied.length > 512 || configured.length > 512) return false;
  return timingSafeEqual(
    createHash('sha256').update(configured).digest(),
    createHash('sha256').update(supplied).digest(),
  );
}

@Injectable()
export class OrganizationBranchServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const caller = request.headers['x-funtino-service-id'];
    const token = request.headers['x-funtino-service-token'];
    if (typeof caller !== 'string' || !Object.hasOwn(callers, caller)) {
      throw new UnauthorizedException('Invalid service identity.');
    }
    if (
      (caller === 'device-integration' || caller === 'identity-access' || caller === 'wallet') &&
      (request.method !== 'POST' || request.routeOptions.url !== '/internal/v1/scopes/validate')
    ) {
      throw new UnauthorizedException('This service may only validate organization/branch scope.');
    }
    const envName = callers[caller as keyof typeof callers];
    const configured = process.env[envName];
    if (!configured || configured.length < 32) {
      throw new ServiceUnavailableException('Service authentication is not configured.');
    }
    if (!sameSecret(configured, token))
      throw new UnauthorizedException('Invalid service credential.');
    return true;
  }
}
