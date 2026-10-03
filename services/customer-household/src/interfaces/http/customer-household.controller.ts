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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CustomerHouseholdService,
  type HouseholdCommandMeta,
} from '../../application/customer-household.service.js';
import { CustomerHouseholdServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const createHouseholdSchema = z
  .object({
    ownerUserId: uuid,
    name: z.string().trim().min(2).max(80),
  })
  .strict();
const addMemberSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    relationship: z.string().trim().min(2).max(40),
    birthDate: z.string().date().nullable().optional(),
    isDependent: z.boolean().optional(),
  })
  .strict();

@Controller('internal/v1')
@UseGuards(CustomerHouseholdServiceTokenGuard)
export class CustomerHouseholdController {
  constructor(private readonly service: CustomerHouseholdService) {}

  @Get('users/:userId/households')
  @Header('cache-control', 'private, no-store')
  @Header('pragma', 'no-cache')
  listForUser(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.service.listHouseholdsForUser(userId);
  }

  @Get('households/:householdId/validation')
  @Header('cache-control', 'private, no-store')
  validateForWallet(@Param('householdId', new ParseUUIDPipe()) householdId: string) {
    return this.service.validateHousehold(householdId);
  }

  @Post('households')
  @HttpCode(201)
  create(
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = createHouseholdSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Household request is invalid.');
    return this.service.createHousehold(parsed.data, commandMeta(headers));
  }

  @Post('households/:householdId/members')
  @HttpCode(201)
  addMember(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = addMemberSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Household member request is invalid.');
    return this.service.addMember(householdId, parsed.data, commandMeta(headers));
  }
}

function commandMeta(headers: Record<string, string | string[] | undefined>): HouseholdCommandMeta {
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
    actorUserId: actorUserId.data,
    correlationId: correlationId.data,
    idempotencyKey: idempotencyKey.data,
    callerService: 'api-gateway',
  };
}
