import { BadRequestException, Body, Controller, Header, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CardLedgerService } from '../../application/card-ledger.service.js';
import { WalletDeviceIntegrationTokenGuard } from './device-integration-token.guard.js';

const uuid = z.string().uuid();
const snapshotSchema = z.object({
  snapshotId: uuid,
  sourceInstanceId: uuid,
  organizationId: uuid,
  branchId: uuid,
  cardId: uuid,
  householdId: uuid,
  memberId: uuid.nullable(),
  snapshotVersion: z.string().trim().min(1).max(120),
  localSequence: z.number().int().nonnegative().safe(),
  balanceRial: z.number().int().nonnegative().safe(),
  currencyCode: z.literal('IRR'),
  observedAt: z.string().datetime({ offset: true }),
}).strict();

@Controller('internal/v2/edge/balances')
@UseGuards(WalletDeviceIntegrationTokenGuard)
export class EdgeBalanceReconciliationController {
  constructor(private readonly ledger: CardLedgerService) {}

  @Post('reconcile')
  @Header('cache-control', 'private, no-store')
  reconcile(@Body() rawBody: unknown) {
    const parsed = snapshotSchema.safeParse(rawBody);
    if (!parsed.success) return this.rejectInvalid();
    return this.ledger.reconcilePhysicalBalanceSnapshot(parsed.data);
  }

  private rejectInvalid(): never {
    throw new BadRequestException('Physical balance snapshot is invalid.');
  }
}
