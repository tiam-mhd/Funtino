import { BadRequestException, Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { EdgeProvisionalCustomerService } from '../../application/edge-provisional-customer.service.js';
import { CustomerHouseholdEdgeServiceTokenGuard } from './edge-service-token.guard.js';

const uuid = z.string().uuid();
const requestSchema = z
  .object({
    provisionalId: uuid,
    sourceInstanceId: uuid,
    branchId: uuid,
  })
  .strict();

@Controller('internal/v1/edge/provisional-customers')
@UseGuards(CustomerHouseholdEdgeServiceTokenGuard)
export class EdgeProvisionalCustomerController {
  constructor(private readonly provisionals: EdgeProvisionalCustomerService) {}

  @Post()
  create(
    @Body() rawBody: unknown,
    @Headers('x-funtino-actor-user-id') actorUserId: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const parsed = requestSchema.safeParse(rawBody);
    if (
      !parsed.success ||
      !uuid.safeParse(actorUserId).success ||
      !uuid.safeParse(correlationId).success ||
      !uuid.safeParse(idempotencyKey).success
    ) {
      throw new BadRequestException('Provisional customer request is invalid.');
    }
    return this.provisionals.create({
      ...parsed.data,
      actorUserId: actorUserId!,
      correlationId: correlationId!,
      idempotencyKey: idempotencyKey!,
    });
  }
}
