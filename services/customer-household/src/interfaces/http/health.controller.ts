import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
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
    if (
      tokens.some((token) => !token || token.length < 32 || token.length > 512) ||
      new Set(tokens).size !== tokens.length
    ) {
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
    } catch {
      throw new ServiceUnavailableException('Customer & Household database is not ready.');
    }
  }
}
