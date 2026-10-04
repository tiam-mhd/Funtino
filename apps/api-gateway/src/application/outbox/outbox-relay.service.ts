import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  createSafeErrorDiagnostic,
  RabbitEventBus,
  writeStructuredLog,
} from '@funtino/backend-core';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';

@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly eventBus = new RabbitEventBus(process.env.RABBITMQ_URL, 'api-gateway');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), 1_000);
    void this.flush();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.eventBus.close();
  }

  private async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (!process.env.RABBITMQ_URL) {
      this.running = false;
      return;
    }
    let events = [] as Awaited<ReturnType<FuntinoStorePort['takePendingEvents']>>;
    let stage = 'claim_batch';
    try {
      events = await this.store.takePendingEvents();
      stage = 'publish_events';
      for (const event of events) await this.eventBus.publish(event);
      stage = 'ack_events';
      await this.store.ackEvents(events.map((event) => event.eventId));
      if (events.length) {
        writeStructuredLog({
          level: 'info',
          event: 'outbox.batch_published',
          service: 'api-gateway',
          component: 'OutboxRelay.flush',
          stage: 'ack_events',
          publishedCount: events.length,
        });
      }
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'outbox.batch_failed',
        service: 'api-gateway',
        component: 'OutboxRelay.flush',
        stage,
        dependency: 'postgresql_or_rabbitmq',
        error: createSafeErrorDiagnostic(error),
        eventCount: events.length,
        events: events.slice(0, 5).map((event) => ({
          eventId: event.eventId,
          eventType: event.eventType,
          correlationId: event.correlationId,
        })),
      });
      try {
        stage = 'requeue_events';
        await this.store.requeueEvents(events);
      } catch (requeueError) {
        writeStructuredLog({
          level: 'fatal',
          event: 'outbox.requeue.failed',
          service: 'api-gateway',
          component: 'OutboxRelay.flush',
          stage,
          dependency: 'postgresql',
          error: createSafeErrorDiagnostic(requeueError),
          originalFailure: createSafeErrorDiagnostic(error),
          eventCount: events.length,
        });
        throw requeueError;
      }
    } finally {
      this.running = false;
    }
  }
}
