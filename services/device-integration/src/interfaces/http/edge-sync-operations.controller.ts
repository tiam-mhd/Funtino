import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { EdgeSyncOperationsService } from '../../application/edge-sync-operations.service.js';
import { DeviceIntegrationServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const replaySchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();

@Controller('internal/v1/operations/edge-sync')
@UseGuards(DeviceIntegrationServiceTokenGuard)
export class EdgeSyncOperationsController {
  constructor(private readonly edgeSync: EdgeSyncOperationsService) {}

  @Get('organizations/:organizationId/branches/:branchId')
  getBranchStatus(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.edgeSync.getBranchStatus(organizationId, branchId);
  }

  @Post('organizations/:organizationId/branches/:branchId/dead-letters/:eventId/replay')
  replayDeadLetter(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = replaySchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Replay reason is invalid.');
    const single = (name: string) => {
      const value = headers[name];
      return typeof value === 'string' ? value : undefined;
    };
    const actorUserId = uuid.safeParse(single('x-funtino-actor-user-id'));
    const correlationId = uuid.safeParse(single('x-correlation-id'));
    const idempotencyKey = uuid.safeParse(single('idempotency-key'));
    if (!actorUserId.success || !correlationId.success || !idempotencyKey.success)
      throw new BadRequestException('Actor, correlation and idempotency headers are required.');
    return this.edgeSync.replayDeadLetter({
      organizationId,
      branchId,
      eventId,
      reason: parsed.data.reason,
      actorUserId: actorUserId.data,
      correlationId: correlationId.data,
      idempotencyKey: idempotencyKey.data,
    });
  }
}
