import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AnalyticsEventConsumer } from '../../infrastructure/messaging/analytics-event-consumer.service.js';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service.js';

@Controller('health')
export class AnalyticsHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consumer: AnalyticsEventConsumer,
  ) {}

  @Get('live')
  live() {
    return { status: 'success', data: { status: 'ok', service: 'analytics-read-model' } };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const control = await this.prisma.projectionControl.findUnique({ where: { id: 1 } });
      if (!control?.activeGenerationId) throw new Error('projection unavailable');
      if (process.env.NODE_ENV === 'production' && !this.consumer.isConnected()) {
        throw new Error('event consumer unavailable');
      }
      return {
        status: 'success',
        data: {
          status: 'ready',
          service: 'analytics-read-model',
          eventConsumerConfigured: this.consumer.isConfigured(),
          eventConsumerConnected: this.consumer.isConnected(),
          lastProcessedAt: control.lastProcessedAt?.toISOString() ?? null,
        },
      };
    } catch {
      throw new ServiceUnavailableException('Analytics projection is not ready.');
    }
  }
}
