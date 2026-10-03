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
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CardInventoryService } from '../../application/card-inventory.service.js';
import { WalletServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const reason = z.string().trim().min(8).max(500);
const assignSchema = z.object({ householdId: uuid, reason }).strict();
const transferSchema = z.object({ householdId: uuid, reason }).strict();
const cancelSchema = z.object({ reason }).strict();
const listSchema = z
  .object({
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

@Controller('internal/v1')
@UseGuards(WalletServiceTokenGuard)
export class CardAssignmentController {
  constructor(private readonly service: CardInventoryService) {}

  @Get('organizations/:organizationId/branches/:branchId/card-assignments')
  @Header('cache-control', 'private, no-store')
  listBranch(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() rawQuery: unknown,
  ) {
    const parsed = listSchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException('Card assignment query is invalid.');
    return this.service.listBranchAssignments({ organizationId, branchId, ...parsed.data });
  }

  @Get('households/:householdId/card-assignments')
  @Header('cache-control', 'private, no-store')
  listHousehold(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Query() rawQuery: unknown,
  ) {
    const parsed = listSchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException('Card assignment query is invalid.');
    return this.service.listHouseholdAssignments({ householdId, ...parsed.data });
  }

  @Post('organizations/:organizationId/branches/:branchId/cards/:cardId/assignments')
  @HttpCode(201)
  assign(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = assignSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Card assignment request is invalid.');
    return this.service.assignCard(
      { organizationId, branchId, cardId, ...parsed.data },
      commandMeta(headers),
    );
  }

  @Post('organizations/:organizationId/branches/:branchId/card-assignments/:assignmentId/transfer')
  @HttpCode(200)
  transfer(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = transferSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Card assignment transfer is invalid.');
    return this.service.transferAssignment(
      { organizationId, branchId, assignmentId, ...parsed.data },
      commandMeta(headers),
    );
  }

  @Post('organizations/:organizationId/branches/:branchId/card-assignments/:assignmentId/cancel')
  @HttpCode(200)
  cancel(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = cancelSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Card assignment cancellation is invalid.');
    return this.service.cancelAssignment(
      { organizationId, branchId, assignmentId, ...parsed.data },
      commandMeta(headers),
    );
  }

  @Get('assignments/:assignmentId')
  @Header('cache-control', 'private, no-store')
  get(@Param('assignmentId', new ParseUUIDPipe()) assignmentId: string) {
    return this.service.getAssignment(assignmentId);
  }
}

function commandMeta(headers: Record<string, string | string[] | undefined>) {
  const single = (name: string): string | undefined => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  const actorUserId = uuid.safeParse(single('x-funtino-actor-user-id'));
  const correlationId = uuid.safeParse(single('x-correlation-id'));
  const idempotencyKey = uuid.safeParse(single('idempotency-key'));
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
