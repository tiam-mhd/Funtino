import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { createSafeErrorDiagnostic, writeStructuredLog } from '@funtino/backend-core';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'customer-household',
      version: process.env.APP_VERSION ?? 'dev',
    };
  }

  @Get('ready')
  async ready() {
    const tokens = [
      process.env.CUSTOMER_HOUSEHOLD_GATEWAY_TOKEN,
      process.env.CUSTOMER_HOUSEHOLD_WALLET_TOKEN,
    ];
    const ttlDays = Number(process.env.CUSTOMER_FAMILY_UNREGISTERED_INVITATION_TTL_DAYS ?? '7');
    if (
      tokens.some((token) => !token || token.length < 32 || token.length > 512) ||
      new Set(tokens).size !== tokens.length ||
      !Number.isInteger(ttlDays) ||
      ttlDays < 1 ||
      ttlDays > 30
    ) {
      writeStructuredLog({
        level: 'error',
        event: 'service.readiness.failed',
        service: 'customer-household',
        component: 'HealthController.ready',
        stage: 'service_token_validation',
        dependency: 'service_configuration',
        configurationKeys: [
          'CUSTOMER_HOUSEHOLD_GATEWAY_TOKEN',
          'CUSTOMER_HOUSEHOLD_WALLET_TOKEN',
          'CUSTOMER_FAMILY_UNREGISTERED_INVITATION_TTL_DAYS',
        ],
      });
      throw new ServiceUnavailableException('Service authentication is not configured.');
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const [pending, deadLettered] = await Promise.all([
        this.prisma.outboxEvent.count({ where: { publishedAt: null, deadLetteredAt: null } }),
        this.prisma.outboxEvent.count({ where: { deadLetteredAt: { not: null } } }),
      ]);
      return {
        status: 'ready',
        service: 'customer-household',
        outbox: { pending, deadLettered, publisherConfigured: Boolean(process.env.RABBITMQ_URL) },
      };
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'service.readiness.failed',
        service: 'customer-household',
        component: 'HealthController.ready',
        stage: 'database_and_outbox_probe',
        dependency: 'postgresql',
        error: createSafeErrorDiagnostic(error),
      });
      throw new ServiceUnavailableException('Customer & Household database is not ready.');
    }
  }
}
