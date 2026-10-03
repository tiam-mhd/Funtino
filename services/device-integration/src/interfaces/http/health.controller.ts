import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DeviceRegistryService } from '../../application/device-registry.service.js';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly service: DeviceRegistryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('live')
  live() {
    return { status: 'success', data: { status: 'ok', service: 'device-integration' } };
  }

  @Get('ready')
  async ready() {
    await this.service.isReady();
    let pending: number;
    let deadLettered: number;
    try {
      [pending, deadLettered] = await Promise.all([
        this.prisma.outboxEvent.count({ where: { publishedAt: null, deadLetteredAt: null } }),
        this.prisma.outboxEvent.count({ where: { deadLetteredAt: { not: null } } }),
      ]);
    } catch {
      throw new ServiceUnavailableException('Device registry database is unavailable.');
    }
    return {
      status: 'success',
      data: {
        status: 'ready',
        service: 'device-integration',
        outbox: { pending, deadLettered, publisherConfigured: Boolean(process.env.RABBITMQ_URL) },
      },
    };
  }
}
