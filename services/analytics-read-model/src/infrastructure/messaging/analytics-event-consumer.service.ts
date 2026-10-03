import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { consumeRabbitQueue } from '@funtino/backend-core';
import { eventTypes } from '@funtino/event-contracts';
import { AnalyticsProjectionService } from '../../application/analytics-projection.service.js';

const routingKeys = [
  eventTypes.organizationCreated,
  eventTypes.organizationUpdated,
  eventTypes.organizationStatusChanged,
  eventTypes.branchCreated,
  eventTypes.branchUpdated,
  eventTypes.branchStatusChanged,
  eventTypes.deviceRegistered,
  eventTypes.deviceUpdated,
  eventTypes.deviceHealthObserved,
];

@Injectable()
export class AnalyticsEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsEventConsumer.name);
  private closeConsumer?: () => Promise<void>;
  private readonly rabbitUrl = process.env.RABBITMQ_URL;

  constructor(private readonly projection: AnalyticsProjectionService) {}

  async onModuleInit(): Promise<void> {
    await this.projection.initialize();
    if (!this.rabbitUrl) {
      if (process.env.NODE_ENV === 'production')
        throw new Error('RABBITMQ_URL is required in production.');
      this.logger.warn('RabbitMQ is not configured; analytics event coverage will not advance.');
      return;
    }
    this.closeConsumer = await consumeRabbitQueue({
      url: this.rabbitUrl,
      queue: 'analytics-read-model.v1',
      routingKeys,
      handler: async (event) => {
        await this.projection.ingest(event);
      },
    });
    await this.projection.markConsumerCoverageStarted();
    this.logger.log('Analytics event consumer connected.');
  }

  isConfigured(): boolean {
    return Boolean(this.rabbitUrl);
  }
  isConnected(): boolean {
    return Boolean(this.closeConsumer);
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeConsumer?.();
  }
}
