import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isServiceTokenValid } from './service-token.guard.js';

@Injectable()
export class EdgeOperatorGatewayTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return validateService(context, 'api-gateway', 'IDENTITY_ACCESS_SERVICE_TOKEN');
  }
}

@Injectable()
export class EdgeOperatorDeviceIntegrationTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return validateService(
      context,
      'device-integration',
      'IDENTITY_ACCESS_DEVICE_INTEGRATION_TOKEN',
    );
  }
}

function validateService(context: ExecutionContext, serviceId: string, envName: string): boolean {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  const configured = process.env[envName];
  if (!configured || configured.length < 32 || configured.length > 512) {
    throw new ServiceUnavailableException('Service authentication is not configured.');
  }
  if (
    request.headers['x-funtino-service-id'] !== serviceId ||
    !isServiceTokenValid(configured, request.headers['x-funtino-service-token'])
  ) {
    throw new UnauthorizedException('Invalid service identity or credential.');
  }
  return true;
}
