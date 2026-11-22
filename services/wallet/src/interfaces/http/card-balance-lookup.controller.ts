import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CardBalanceLookupService } from '../../application/card-balance-lookup.service.js';
import { WalletServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const cardBalanceLookupSchema = z
  .object({
    cardUidHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
    audience: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('customer'),
          householdIds: z
            .array(uuid)
            .min(1)
            .max(200)
            .refine(
              (items) => new Set(items.map((item) => item.toLowerCase())).size === items.length,
            ),
        })
        .strict(),
      z.object({ type: z.literal('operations'), organizationId: uuid, branchId: uuid }).strict(),
    ]),
  })
  .strict();

@Controller('internal/v1/cards')
@UseGuards(WalletServiceTokenGuard)
export class CardBalanceLookupController {
  constructor(private readonly lookupService: CardBalanceLookupService) {}

  @Post('balance-lookup')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async lookup(@Body() rawBody: unknown) {
    const parsed = cardBalanceLookupSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Card balance lookup request is invalid.');
    return this.lookupService.lookup({
      cardUidHash: parsed.data.cardUidHash.toLowerCase(),
      audience: parsed.data.audience,
    });
  }
}
