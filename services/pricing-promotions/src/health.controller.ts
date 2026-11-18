import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('live')
  live() { return { status: 'ok', service: 'pricing-promotions', version: process.env.APP_VERSION ?? 'dev' }; }
  @Get('ready')
  async ready() {
    const token = process.env.PRICING_DEVICE_INTEGRATION_TOKEN;
    if (!token || token.length < 32 || token.length > 512)
      throw new ServiceUnavailableException('Pricing service authentication is not configured.');
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', service: 'pricing-promotions', executionEnabled: false };
    } catch {
      throw new ServiceUnavailableException('Pricing database is not ready.');
    }
  }
}
