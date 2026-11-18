import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { consumeRabbitQueue } from '@funtino/backend-core';
import {
  edgeTransactionImportedV2PayloadSchema,
  eventTypes,
  type EventEnvelope,
} from '@funtino/event-contracts';
import { CardLedgerService } from './card-ledger.service.js';

@Injectable()
export class CardLedgerEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CardLedgerEventConsumer.name);
  private stopConsumer?: () => Promise<void>;

  constructor(private readonly ledger: CardLedgerService) {}

  async onModuleInit(): Promise<void> {
    this.stopConsumer = await consumeRabbitQueue({
      url: process.env.RABBITMQ_URL,
      queue: 'funtino.wallet.edge.v2',
      routingKeys: [eventTypes.deviceEdgeTransactionImported],
      handler: async (event) => this.handle(event),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsumer?.();
  }

  private async handle(event: EventEnvelope): Promise<void> {
    if (event.eventType !== eventTypes.deviceEdgeTransactionImported) return;
    const payload = edgeTransactionImportedV2PayloadSchema.parse(event.payload);
    const result = await this.ledger.applyEdgeEvent(payload, event.correlationId);
    if (result.status === 'pending_review') {
      this.logger.warn(`edge event requires review: ${result.errorCode}`);
    }
  }
}
