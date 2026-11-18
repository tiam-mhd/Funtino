import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { DeviceRegistryService } from '../../application/device-registry.service.js';
import { DeviceIntegrationServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const installSchema = z
  .object({
    sourceInstanceId: uuid,
    organizationId: uuid,
    branchId: uuid,
    currentKeyId: z.string().trim().min(1).max(120),
  })
  .strict();
const rotateSchema = z.object({ currentKeyId: z.string().trim().min(1).max(120) }).strict();

@Controller('internal/v1/edge/installations')
@UseGuards(DeviceIntegrationServiceTokenGuard)
export class EdgeInstallationController {
  constructor(private readonly service: DeviceRegistryService) {}

  @Post()
  @HttpCode(201)
  register(
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = installSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Edge installation request is invalid.');
    return this.service.registerEdgeInstallation(parsed.data, commandMeta(headers));
  }

  @Post(':sourceInstanceId/rotate-key')
  @HttpCode(200)
  rotateKey(
    @Param('sourceInstanceId', new ParseUUIDPipe()) sourceInstanceId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = rotateSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Edge key rotation request is invalid.');
    const expectedVersion = Number(ifMatch?.trim().replace(/^"|"$/gu, ''));
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new BadRequestException('If-Match must contain a positive installation version.');
    return this.service.rotateEdgeInstallationKey(
      { sourceInstanceId, currentKeyId: parsed.data.currentKeyId, expectedVersion },
      commandMeta(headers),
    );
  }
}

function commandMeta(headers: Record<string, string | string[] | undefined>) {
  const single = (name: string) => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  const actorUserId = uuid.safeParse(single('x-funtino-actor-user-id'));
  const correlationId = uuid.safeParse(single('x-correlation-id'));
  const idempotencyKey = uuid.safeParse(single('idempotency-key'));
  if (!actorUserId.success || !correlationId.success || !idempotencyKey.success)
    throw new BadRequestException('Actor, correlation and idempotency headers are required.');
  return {
    callerService: 'api-gateway' as const,
    actorUserId: actorUserId.data,
    correlationId: correlationId.data,
    idempotencyKey: idempotencyKey.data,
  };
}
