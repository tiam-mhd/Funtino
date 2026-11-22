import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { EdgeOperatorPairingService } from '../../application/edge-operator-pairing.service.js';
import { DeviceIntegrationServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const permission = z.enum([
  'card.inventory.read',
  'card.inventory.manage',
  'card.assign',
  'card.transfer',
  'card.unassign',
  'customer.lookup.limited',
  'customer.provisional.create',
  'customer.family.read',
  'customer.family.manage',
  'customer.profile.manage',
]);
const approvalSchema = z
  .object({
    code: z.string().trim().min(10).max(16),
    organizationId: uuid,
    branchId: uuid,
    managementSessionId: uuid,
    permissionKeys: z.array(permission).min(1).max(10),
  })
  .strict()
  .refine((value) => new Set(value.permissionKeys).size === value.permissionKeys.length);

@Controller('internal/v1/operations/edge-pairings')
@UseGuards(DeviceIntegrationServiceTokenGuard)
export class EdgeOperatorPairingApprovalController {
  constructor(private readonly service: EdgeOperatorPairingService) {}

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = approvalSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Operator pairing approval is invalid.');
    const single = (name: string) => {
      const value = headers[name];
      return typeof value === 'string' ? value : undefined;
    };
    const actorUserId = uuid.safeParse(single('x-funtino-actor-user-id'));
    const correlationId = uuid.safeParse(single('x-correlation-id'));
    const idempotencyKey = uuid.safeParse(single('idempotency-key'));
    if (!actorUserId.success || !correlationId.success || !idempotencyKey.success)
      throw new BadRequestException('Actor, correlation and idempotency headers are required.');
    return this.service.approve({
      ...parsed.data,
      actorUserId: actorUserId.data,
      correlationId: correlationId.data,
      idempotencyKey: idempotencyKey.data,
    });
  }
}
