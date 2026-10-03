import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'wallet',
      version: process.env.APP_VERSION ?? 'dev',
    };
  }

  @Get('ready')
  async ready() {
    const gatewayToken = process.env.WALLET_GATEWAY_TOKEN;
    const branchToken = process.env.WALLET_ORGANIZATION_BRANCH_TOKEN;
    if (
      !isValidServiceToken(gatewayToken) ||
      !isValidServiceToken(branchToken) ||
      gatewayToken === branchToken
    ) {
      throw new ServiceUnavailableException('Wallet service authentication is not configured.');
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const [pending, deadLettered] = await Promise.all([
        this.prisma.outboxEvent.count({ where: { publishedAt: null, deadLetteredAt: null } }),
        this.prisma.outboxEvent.count({ where: { deadLetteredAt: { not: null } } }),
      ]);
      return {
        status: 'ready',
        service: 'wallet',
        outbox: { pending, deadLettered, publisherConfigured: Boolean(process.env.RABBITMQ_URL) },
      };
    } catch {
      throw new ServiceUnavailableException('Wallet database is not ready.');
    }
  }
}

function isValidServiceToken(token: string | undefined): boolean {
  return Boolean(token && token.length >= 32 && token.length <= 512);
}
