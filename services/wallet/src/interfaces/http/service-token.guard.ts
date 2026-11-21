import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class WalletServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const caller = request.headers['x-funtino-service-id'];
    const supplied = request.headers['x-funtino-service-token'];
    const deviceIntegrationRoutes = new Set([
      'GET /internal/v1/organizations/:organizationId/branches/:branchId/edge-card-mappings',
      'POST /internal/v2/edge/balances/reconcile',
      'GET /internal/v1/organizations/:organizationId/branches/:branchId/card-assignments',
      'POST /internal/v1/organizations/:organizationId/branches/:branchId/cards/:cardId/assignments',
      'GET /internal/v1/organizations/:organizationId/branches/:branchId/cards/:cardId',
      'PATCH /internal/v1/organizations/:organizationId/branches/:branchId/cards/:cardId',
      'POST /internal/v1/households/:householdId/cards/:cardId/lifecycle-requests',
    ]);
    const configured =
      caller === 'device-integration'
        ? process.env.DEVICE_INTEGRATION_WALLET_TOKEN
        : process.env.WALLET_GATEWAY_TOKEN;

    if (!configured || configured.length < 32 || configured.length > 512) {
      throw new ServiceUnavailableException('Wallet service authentication is not configured.');
    }
    if (
      (caller !== 'api-gateway' && caller !== 'device-integration') ||
      (caller === 'device-integration' &&
        !deviceIntegrationRoutes.has(`${request.method} ${request.routeOptions.url}`)) ||
      (caller === 'api-gateway' &&
        request.routeOptions.url === '/internal/v2/edge/balances/reconcile') ||
      typeof supplied !== 'string'
    ) {
      throw new UnauthorizedException('Invalid internal service identity.');
    }
    if (supplied.length < 32 || supplied.length > 512) {
      throw new UnauthorizedException('Invalid internal service credential.');
    }

    const expectedHash = createHash('sha256').update(configured).digest();
    const suppliedHash = createHash('sha256').update(supplied).digest();
    if (!timingSafeEqual(expectedHash, suppliedHash)) {
      throw new UnauthorizedException('Invalid internal service credential.');
    }
    return true;
  }
}
