import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { createSafeErrorDiagnostic, writeStructuredLog } from '@funtino/backend-core';
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
    let readinessStage = 'database_probe';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      readinessStage = 'projection_control_query';
      const control = await this.prisma.projectionControl.findUnique({ where: { id: 1 } });
      if (!control?.activeGenerationId) {
        readinessStage = 'active_generation_validation';
        throw new Error('Projection generation is not initialized.');
      }
      if (process.env.NODE_ENV === 'production' && !this.consumer.isConnected()) {
        readinessStage = 'event_consumer_connectivity';
        throw new Error('Analytics event consumer is not connected.');
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
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'service.readiness.failed',
        service: 'analytics-read-model',
        component: 'AnalyticsHealthController.ready',
        stage: readinessStage,
        dependency: 'postgresql_or_rabbitmq',
        error: createSafeErrorDiagnostic(error),
      });
      throw new ServiceUnavailableException('Analytics projection is not ready.');
    }
  }
}
