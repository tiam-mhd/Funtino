import { Controller, Get, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { success } from './current-user.decorator.js';
import { getCustomerFamilyPhoneHashSecret } from '../../application/customer/customer-family.config.js';

@Controller('health')
export class HealthController {
  @Get('live')
  live(@Req() request: FastifyRequest & { requestId?: string; correlationId?: string }) {
    return success(
      { status: 'ok', service: 'api-gateway', version: process.env.APP_VERSION ?? 'dev' },
      request,
    );
  }

  @Get('ready')
  ready(@Req() request: FastifyRequest & { requestId?: string; correlationId?: string }) {
    const storageMode = process.env.STORAGE_MODE ?? 'memory';
    const customerFamilyConfigured = getCustomerFamilyPhoneHashSecret() !== null;
    return success(
      {
        status: customerFamilyConfigured ? 'ready' : 'degraded',
        service: 'api-gateway',
        storageMode,
        rabbitConfigured: Boolean(process.env.RABBITMQ_URL),
        databaseConfigured: Boolean(process.env.DATABASE_URL),
        identityAccessConfigured: Boolean(
          process.env.IDENTITY_ACCESS_URL &&
            (process.env.IDENTITY_ACCESS_SERVICE_TOKEN?.length ?? 0) >= 32,
        ),
        walletConfigured: Boolean(
          process.env.WALLET_URL && (process.env.WALLET_GATEWAY_TOKEN?.length ?? 0) >= 32,
        ),
        customerFamilyConfigured,
      },
      request,
    );
  }
}
