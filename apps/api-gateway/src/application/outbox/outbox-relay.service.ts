import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RabbitEventBus } from '@funtino/backend-core';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';

@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
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
    try {
      events = await this.store.takePendingEvents();
      for (const event of events) await this.eventBus.publish(event);
      await this.store.ackEvents(events.map((event) => event.eventId));
      if (events.length) this.logger.log(`published ${events.length} outbox event(s)`);
    } catch (error) {
      await this.store.requeueEvents(events);
      this.logger.error(error, 'outbox publish failed; events requeued');
    } finally {
      this.running = false;
    }
  }
}
