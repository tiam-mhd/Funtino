import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CardLifecycleRequestService } from '../../application/card-lifecycle-request.service.js';
import { WalletServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const requestSchema = z.object({
  action: z.enum(['lost', 'replacement']),
  reason: z.string().trim().min(8).max(500),
}).strict();
const statusSchema = z.object({
  status: z.enum(['in_review', 'approved', 'rejected', 'completed']),
  reason: z.string().trim().min(8).max(500),
}).strict();
const branchQuerySchema = z.object({
  status: z.enum(['requested', 'in_review', 'approved', 'rejected', 'completed']).optional(),
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

@Controller('internal/v1')
@UseGuards(WalletServiceTokenGuard)
export class CardLifecycleRequestController {
  constructor(private readonly requests: CardLifecycleRequestService) {}

  @Get('households/:householdId/cards/:cardId/lifecycle-requests')
  @Header('cache-control', 'private, no-store')
  listForHousehold(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
  ) {
    return this.requests.listForHousehold(householdId, cardId);
  }

  @Post('households/:householdId/cards/:cardId/lifecycle-requests')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  createForHousehold(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Card lifecycle request is invalid.');
    const single = (name: string) => typeof headers[name] === 'string' ? headers[name] as string : undefined;
    const requesterId = uuid.safeParse(single('x-funtino-actor-user-id'));
    const correlationId = uuid.safeParse(single('x-correlation-id'));
    const idempotencyKey = uuid.safeParse(single('idempotency-key'));
    if (!requesterId.success || !correlationId.success || !idempotencyKey.success)
      throw new BadRequestException('Actor, correlation, and idempotency headers are required.');
    return this.requests.createRequest({
      householdId,
      cardId,
      ...parsed.data,
      requesterId: requesterId.data,
      correlationId: correlationId.data,
      idempotencyKey: idempotencyKey.data,
    });
  }

  @Get('organizations/:organizationId/branches/:branchId/card-lifecycle-requests')
  @Header('cache-control', 'private, no-store')
  listForBranch(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Query() rawQuery: unknown,
  ) {
    const parsed = branchQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException('Card lifecycle request query is invalid.');
    return this.requests.listForBranch({ organizationId, branchId, ...parsed.data });
  }

  @Patch('organizations/:organizationId/branches/:branchId/card-lifecycle-requests/:requestId')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store')
  transition(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = statusSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Card lifecycle action is invalid.');
    const single = (name: string) => typeof headers[name] === 'string' ? headers[name] as string : undefined;
    const actorUserId = uuid.safeParse(single('x-funtino-actor-user-id'));
    const correlationId = uuid.safeParse(single('x-correlation-id'));
    const idempotencyKey = uuid.safeParse(single('idempotency-key'));
    if (!actorUserId.success || !correlationId.success || !idempotencyKey.success)
      throw new BadRequestException('Actor, correlation, and idempotency headers are required.');
    return this.requests.transitionRequest({
      organizationId,
      branchId,
      requestId,
      ...parsed.data,
      actorUserId: actorUserId.data,
      correlationId: correlationId.data,
      idempotencyKey: idempotencyKey.data,
    });
  }
}
