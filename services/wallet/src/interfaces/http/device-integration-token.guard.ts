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
export class WalletDeviceIntegrationTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const caller = request.headers['x-funtino-service-id'];
    const supplied = request.headers['x-funtino-service-token'];
    const configured = process.env.WALLET_DEVICE_INTEGRATION_TOKEN;
    if (!configured || configured.length < 32 || configured.length > 512)
      throw new ServiceUnavailableException('Wallet device integration authentication is not configured.');
    if (caller !== 'device-integration' || typeof supplied !== 'string' || supplied.length < 32 || supplied.length > 512)
      throw new UnauthorizedException('Invalid internal service identity.');
    const expectedHash = createHash('sha256').update(configured).digest();
    const suppliedHash = createHash('sha256').update(supplied).digest();
    if (!timingSafeEqual(expectedHash, suppliedHash)) throw new UnauthorizedException('Invalid internal service credential.');
    return true;
  }
}
