import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { consumeRabbitQueue, DomainError } from '@funtino/backend-core';
import {
  deviceTransactionImportedPayloadSchema,
  eventTypes,
  missionCompletedPayloadSchema,
  type EventEnvelope,
} from '@funtino/event-contracts';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';

@Injectable()
export class WalletEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WalletEventConsumer.name);
  private stopConsumer?: () => Promise<void>;

  constructor(@Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort) {}

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
    const card = await this.store.getCardByExternalId(payload.externalCardId);
    if (!card) {
      throw new DomainError('NOT_FOUND', 'The imported card is not linked to a household.');
    }
    const wallet = await this.store.getCardWallet(card.id);
    if (!wallet) {
      throw new DomainError('NOT_FOUND', 'The linked card has no wallet.');
    }

    const amountMinor = signedDeviceAmount(payload.transactionKind, payload.amountMinor);
    const result = await this.store.applyWalletLedgerEntry({
      walletId: wallet.id,
      assetType: 'purchased_credit',
      kind: payload.transactionKind,
      amountMinor,
      currency: payload.currency,
      idempotencyKey: `device-transaction:${payload.externalEventId}`,
      source: 'device.transaction-imported',
      occurredAt: payload.occurredAt,
      metadata: {
        transactionId: payload.transactionId,
        externalCardId: payload.externalCardId,
      },
      correlationId: event.correlationId,
      organizationId: event.organizationId,
      branchId: event.branchId,
    });
    await this.store.markCardSynced(payload.externalCardId, payload.occurredAt);
    if (result.created) {
      this.logger.log(`device transaction applied for card ${payload.externalCardId}`);
    }
  }
}

function signedDeviceAmount(
  kind: 'top_up' | 'spend' | 'refund' | 'adjustment',
  amountMinor: number,
): number {
  if (kind === 'spend') return -Math.abs(amountMinor);
  if (kind === 'top_up' || kind === 'refund') return Math.abs(amountMinor);
  return amountMinor;
}
