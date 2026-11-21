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
import { EdgeHouseholdOperationsService } from '../../application/edge-household-operations.service.js';
import { CustomerHouseholdEdgeServiceTokenGuard } from './edge-service-token.guard.js';

const uuid = z.string().uuid();
const searchSchema = z
  .object({
    sourceInstanceId: uuid,
    branchId: uuid,
    query: z.string().trim().min(1).max(120),
    cursor: uuid.optional(),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();
const profileReadSchema = z
  .object({
    sourceInstanceId: uuid,
    branchId: uuid,
    householdIds: z.array(uuid).max(10_000),
  })
  .strict();
const profileUpdateSchema = z
  .object({
    sourceInstanceId: uuid,
    branchId: uuid,
    householdIds: z.array(uuid).max(10_000),
    expectedVersion: z.number().int().positive(),
    firstName: z.string().trim().min(1).max(60).nullable().optional(),
    lastName: z.string().trim().min(1).max(60).nullable().optional(),
    birthDate: z.string().date().nullable().optional(),
    gender: z.enum(['female', 'male', 'other', 'prefer_not_to_say']).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
    avatarPreset: z.string().trim().max(32).nullable().optional(),
  })
  .strict()
  .refine((value) =>
    Object.keys(value).some(
      (key) => !['sourceInstanceId', 'branchId', 'householdIds', 'expectedVersion'].includes(key),
    ),
  );
const householdReadSchema = z.object({ sourceInstanceId: uuid, branchId: uuid }).strict();
const householdUpdateSchema = z
  .object({
    sourceInstanceId: uuid,
    branchId: uuid,
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(2).max(80),
  })
  .strict();
const addMemberSchema = z
  .object({
    sourceInstanceId: uuid,
    branchId: uuid,
    displayName: z.string().trim().min(2).max(80),
    relationship: z.string().trim().min(2).max(40),
    birthDate: z.string().date().nullable().optional(),
    isDependent: z.boolean().optional(),
  })
  .strict();

@Controller('internal/v1/edge')
@UseGuards(CustomerHouseholdEdgeServiceTokenGuard)
export class EdgeHouseholdOperationsController {
  constructor(private readonly service: EdgeHouseholdOperationsService) {}

  @Post('customers/search')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  searchCustomers(
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const body = searchSchema.safeParse(rawBody);
    if (!body.success) throw new BadRequestException('Edge customer search request is invalid.');
    const actor = readActor(headers, false);
    return this.service.searchCustomers({ ...body.data, ...actor });
  }

  @Post('customers/:customerId/read')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  readCustomer(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const body = profileReadSchema.safeParse(rawBody);
    if (!body.success) throw new BadRequestException('Edge profile read request is invalid.');
    return this.service.getCustomerProfile({
      ...body.data,
      ...readActor(headers, false),
      customerId,
    });
  }

  @Get('households/:householdId')
  @Header('cache-control', 'private, no-store')
  readHousehold(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Query() rawQuery: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const query = householdReadSchema.safeParse(rawQuery);
    if (!query.success) throw new BadRequestException('Edge household read request is invalid.');
    return this.service.getHousehold({
      ...query.data,
      ...readActor(headers, false),
      householdId,
    });
  }

  @Patch('customers/:customerId')
  @Header('cache-control', 'no-store')
  updateCustomer(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const body = profileUpdateSchema.safeParse(rawBody);
    if (!body.success) throw new BadRequestException('Edge profile update request is invalid.');
    const meta = readActor(headers, true);
    const { sourceInstanceId, branchId, householdIds, expectedVersion, ...profile } = body.data;
    return this.service.updateProfile({
      sourceInstanceId,
      branchId,
      householdIds,
      ...meta,
      customerId,
      expectedVersion,
      profile,
    });
  }

  @Patch('households/:householdId')
  @Header('cache-control', 'no-store')
  updateHousehold(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const body = householdUpdateSchema.safeParse(rawBody);
    if (!body.success) throw new BadRequestException('Edge household update request is invalid.');
    return this.service.updateHousehold({
      ...body.data,
      ...readActor(headers, true),
      householdId,
    });
  }

  @Post('households/:householdId/members')
  @HttpCode(HttpStatus.CREATED)
  @Header('cache-control', 'no-store')
  addMember(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const body = addMemberSchema.safeParse(rawBody);
    if (!body.success) throw new BadRequestException('Edge household member request is invalid.');
    return this.service.addMember({
      ...body.data,
      ...readActor(headers, true),
      householdId,
    });
  }
}

function readActor(
  headers: Record<string, string | string[] | undefined>,
  mutating: true,
): {
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
};
function readActor(
  headers: Record<string, string | string[] | undefined>,
  mutating: false,
): {
  actorUserId: string;
  correlationId: string;
};
function readActor(headers: Record<string, string | string[] | undefined>, mutating: boolean) {
  const single = (name: string) =>
    typeof headers[name] === 'string' ? (headers[name] as string) : undefined;
  const actorUserId = uuid.safeParse(single('x-funtino-actor-user-id'));
  const correlationId = uuid.safeParse(single('x-correlation-id'));
  const idempotencyKey = mutating ? uuid.safeParse(single('idempotency-key')) : null;
  if (
    !actorUserId.success ||
    !correlationId.success ||
    (idempotencyKey && !idempotencyKey.success)
  ) {
    throw new BadRequestException('Edge actor, correlation, and idempotency headers are invalid.');
  }
  return {
    actorUserId: actorUserId.data,
    correlationId: correlationId.data,
    ...(idempotencyKey ? { idempotencyKey: idempotencyKey.data } : {}),
  };
}
