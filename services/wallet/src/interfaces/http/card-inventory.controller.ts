import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CARD_INVENTORY_STATUSES,
  CARD_MANUAL_STATUS_TARGETS,
} from '../../domain/card-inventory/card-inventory.js';
import { CardInventoryService } from '../../application/card-inventory.service.js';
import { WalletServiceTokenGuard } from './service-token.guard.js';

const cardIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const optionalReason = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => value || undefined);
const registerSchema = z
  .object({ externalCardId: cardIdentifier, reason: optionalReason })
  .strict();
const statusSchema = z
  .object({ status: z.enum(CARD_MANUAL_STATUS_TARGETS), reason: optionalReason })
  .strict();
const listSchema = z
  .object({
    status: z.enum(CARD_INVENTORY_STATUSES).optional(),
    cursor: z.string().uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

@Controller('internal/v1/organizations/:organizationId/branches/:branchId/cards')
@UseGuards(WalletServiceTokenGuard)
export class CardInventoryController {
  constructor(private readonly service: CardInventoryService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() query: unknown,
  ) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Card inventory query is invalid.');
    return this.service.listCards({ organizationId, branchId, ...parsed.data });
  }

  @Get(':cardId')
  @Header('Cache-Control', 'private, no-store')
  get(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
  ) {
    return this.service.getCard(organizationId, branchId, cardId);
  }

  @Post()
  @HttpCode(201)
  register(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Card registration body is invalid.');
    return this.service.registerCard(organizationId, branchId, parsed.data, commandMeta(headers));
  }

  @Patch(':cardId')
  @HttpCode(200)
  changeStatus(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Headers('if-match') ifMatch: unknown,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Card status request is invalid.');
    return this.service.changeStatus(
      {
        organizationId,
        branchId,
        cardId,
        expectedVersion: parseVersion(ifMatch),
        status: parsed.data.status,
        reason: parsed.data.reason ?? null,
      },
      commandMeta(headers),
    );
  }
}

function commandMeta(headers: Record<string, string | string[] | undefined>) {
  const single = (name: string): string | undefined => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  const actorUserId = z.string().uuid().safeParse(single('x-funtino-actor-user-id'));
  const correlationId = z.string().uuid().safeParse(single('x-correlation-id'));
  const idempotencyKey = z.string().uuid().safeParse(single('idempotency-key'));
  if (!actorUserId.success || !correlationId.success || !idempotencyKey.success) {
    throw new BadRequestException('Actor, correlation, and Idempotency-Key headers are required.');
  }
  return {
    callerService: 'api-gateway' as const,
    actorUserId: actorUserId.data,
    correlationId: correlationId.data,
    idempotencyKey: idempotencyKey.data,
  };
}

function parseVersion(value: unknown): number {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException('If-Match is required.');
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new BadRequestException('If-Match version is invalid.');
  }
  const version = Number(normalized);
  if (!Number.isSafeInteger(version)) {
    throw new BadRequestException('If-Match version is invalid.');
  }
  return version;
}
