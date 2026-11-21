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
export class CustomerHouseholdEdgeServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const configured = process.env.CUSTOMER_HOUSEHOLD_DEVICE_INTEGRATION_TOKEN;
    if (!configured || configured.length < 32 || configured.length > 512) {
      throw new ServiceUnavailableException('Edge service authentication is not configured.');
    }
    const routeKey = `${request.method} ${request.routeOptions.url}`;
    const deviceIntegrationRoutes = new Set([
      'POST /internal/v1/edge/provisional-customers',
      'POST /internal/v1/edge/customers/search',
      'POST /internal/v1/edge/customers/:customerId/read',
      'GET /internal/v1/edge/households/:householdId',
      'PATCH /internal/v1/edge/customers/:customerId',
      'PATCH /internal/v1/edge/households/:householdId',
      'POST /internal/v1/edge/households/:householdId/members',
    ]);
    if (
      !deviceIntegrationRoutes.has(routeKey) ||
      request.headers['x-funtino-service-id'] !== 'device-integration'
    ) {
      throw new UnauthorizedException('Device Integration is not allowed to call this endpoint.');
    }
    const supplied = request.headers['x-funtino-service-token'];
    if (
      typeof supplied !== 'string' ||
      supplied.length < 32 ||
      supplied.length > 512 ||
      !timingSafeEqual(
        createHash('sha256').update(configured).digest(),
        createHash('sha256').update(supplied).digest(),
      )
    ) {
      throw new UnauthorizedException('Invalid service credential.');
    }
    return true;
  }
}
