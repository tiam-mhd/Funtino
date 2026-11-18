import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { consumeRabbitQueue, DomainError } from '@funtino/backend-core';
import {
  deviceTransactionImportedPayloadSchema,
  eventTypes,
  missionCompletedPayloadSchema,
  type EventEnvelope,
} from '@funtino/event-contracts';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import { WalletClient } from '../../infrastructure/wallet/wallet.client.js';

@Injectable()
export class WalletEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WalletEventConsumer.name);
  private stopConsumer?: () => Promise<void>;

  constructor(
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
    private readonly wallet: WalletClient,
  ) {}

  async onModuleInit(): Promise<void> {
    this.stopConsumer = await consumeRabbitQueue({
      url: process.env.RABBITMQ_URL,
      queue: 'funtino.wallet.v1',
      routingKeys: [eventTypes.missionCompleted, eventTypes.deviceTransactionImported],
      handler: async (event) => this.handle(event),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsumer?.();
  }

  private async handle(event: EventEnvelope): Promise<void> {
    if (event.eventType === eventTypes.missionCompleted) {
      await this.handleMissionReward(event);
      return;
    }
    if (event.eventType === eventTypes.deviceTransactionImported) {
      await this.handleDeviceTransaction(event);
    }
  }

  private async handleMissionReward(event: EventEnvelope): Promise<void> {
    const payload = missionCompletedPayloadSchema.parse(event.payload);
    if (payload.rewardType === 'coupon') return;

    const wallet = await this.store.ensureWallet(payload.householdId);
    const result = await this.store.applyWalletLedgerEntry({
      walletId: wallet.id,
      assetType: payload.rewardType === 'gift_credit' ? 'gift_credit' : 'loyalty_points',
      kind: 'reward',
      amountMinor: payload.rewardValue,
      currency: wallet.currency,
      idempotencyKey: `mission-reward:${event.eventId}`,
      source: 'loyalty.mission-completed',
      occurredAt: event.occurredAt,
      metadata: { missionId: payload.missionId, householdId: payload.householdId },
      correlationId: event.correlationId,
      organizationId: event.organizationId,
      branchId: event.branchId,
    });
    if (result.created) {
      this.logger.log(`reward ledger entry created for mission ${payload.missionId}`);
    }
  }

  private async handleDeviceTransaction(event: EventEnvelope): Promise<void> {
    const payload = deviceTransactionImportedPayloadSchema.parse(event.payload);
    if (!event.organizationId || !event.branchId) {
      throw new DomainError('VALIDATION_ERROR', 'The legacy device event is missing its organization scope.');
    }
    await this.wallet.importLegacyDeviceEvent({
      organizationId: event.organizationId,
      branchId: event.branchId,
      payload,
    });
    this.logger.log(`legacy device event staged for Wallet: ${event.eventId}`);
  }
}
