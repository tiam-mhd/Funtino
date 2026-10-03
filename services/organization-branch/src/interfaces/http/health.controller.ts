import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'organization-branch',
      version: process.env.APP_VERSION ?? 'dev',
    };
  }

  @Get('ready')
  async ready() {
    const gatewayToken = process.env.ORGANIZATION_BRANCH_GATEWAY_TOKEN;
    const identityToken = process.env.ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN;
    const walletToken = process.env.ORGANIZATION_BRANCH_WALLET_TOKEN;
    const serviceTokens = [gatewayToken, identityToken, walletToken];
    if (
      serviceTokens.some((token) => !token || token.length < 32 || token.length > 512) ||
      new Set(serviceTokens).size !== serviceTokens.length
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
        service: 'organization-branch',
        outbox: { pending, deadLettered, publisherConfigured: Boolean(process.env.RABBITMQ_URL) },
      };
    } catch {
      throw new ServiceUnavailableException('Organization/branch database is not ready.');
    }
  }
}
