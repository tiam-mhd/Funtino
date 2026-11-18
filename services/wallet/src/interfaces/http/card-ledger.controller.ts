import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CardLedgerService } from '../../application/card-ledger.service.js';
import { WalletServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const legacyImportSchema = z.object({
  organizationId: uuid,
  branchId: uuid,
  payload: z.record(z.unknown()),
}).strict();
const transactionQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  kind: z.enum(['top_up', 'spend', 'refund', 'adjustment', 'issuance', 'card_replacement']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict();

@Controller('internal/v1')
@UseGuards(WalletServiceTokenGuard)
export class CardLedgerController {
  constructor(private readonly ledger: CardLedgerService) {}

  @Post('legacy-device-events')
  @Header('cache-control', 'no-store')
  async importLegacyEvent(@Body() rawBody: unknown) {
    const parsed = legacyImportSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Legacy event request is invalid.');
    return this.ledger.importLegacyDeviceEvent(parsed.data);
  }

  @Get('households/:householdId/cards/:cardId/summary')
  @Header('cache-control', 'private, no-store')
  getSummary(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
  ) {
    return this.ledger.getCardSummary(householdId, cardId);
  }

  @Get('edge/operations/organizations/:organizationId/branches/:branchId/review-summary')
  @Header('cache-control', 'private, no-store')
  getBranchEdgeReviewSummary(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.ledger.getBranchEdgeReviewSummary(organizationId, branchId);
  }

  @Get('households/:householdId/cards/:cardId/transactions')
  @Header('cache-control', 'private, no-store')
  listTransactions(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Query() rawQuery: unknown,
  ) {
    const parsed = transactionQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException('Transaction history query is invalid.');
    return this.ledger.listTransactions({ householdId, cardId, ...parsed.data });
  }
}
