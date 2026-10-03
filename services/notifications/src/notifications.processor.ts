import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { consumeRabbitQueue, RabbitEventBus } from '@funtino/backend-core';
import { eventTypes, type EventEnvelope } from '@funtino/event-contracts';

@Injectable()
export class NotificationsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private readonly seen = new Set<string>();
  private readonly publisher = new RabbitEventBus(process.env.RABBITMQ_URL, 'notifications');
  private stopConsumer?: () => Promise<void>;

  async onModuleInit(): Promise<void> {
    this.stopConsumer = await consumeRabbitQueue({
      url: process.env.RABBITMQ_URL,
      queue: 'funtino.notifications.v1',
      routingKeys: [eventTypes.notificationRequested],
      handler: async (event) => this.handle(event),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsumer?.();
    await this.publisher.close();
  }

  private async handle(event: EventEnvelope): Promise<void> {
    if (this.seen.has(event.eventId)) return;
    this.seen.add(event.eventId);
    const payload = event.payload as {
      notificationId: string;
      userId: string;
      channel: 'sms' | 'web_push' | 'in_app';
      template: string;
    };
    const providerMessageId = `dev-${event.eventId}`;
    this.logger.log(`notification ${payload.notificationId} accepted via ${payload.channel}`);
    await this.publisher.publish({
      ...event,
      eventId: crypto.randomUUID(),
      eventType: eventTypes.notificationSent,
      occurredAt: new Date().toISOString(),
      sourceId: 'notifications',
      aggregateId: payload.notificationId,
      causationId: event.eventId,
      payload: {
        notificationId: payload.notificationId,
        userId: payload.userId,
        channel: payload.channel,
        providerMessageId,
      },
    });
  }
}
