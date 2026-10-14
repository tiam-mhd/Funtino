import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { normalizeCorrelationId } from '@funtino/backend-core';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DeviceRegistryService } from '../../application/device-registry.service.js';
import {
  DEVICE_SIGNATURE_VERIFIER,
  type DeviceSignatureVerifier,
} from '../../application/ports/device-signature-verifier.port.js';
import { DeviceIntegrationServiceTokenGuard } from './service-token.guard.js';

const adapterKey = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const externalId = z.string().trim().min(1).max(160);
const deviceType = z.enum(['rfid_reader', 'terminal', 'access_gate', 'other']);
const deviceStatus = z.enum(['active', 'suspended', 'retired']);
const optionalReason = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => value || undefined);

const registerSchema = z
  .object({
    adapterKey,
    externalDeviceId: externalId,
    displayName: z.string().trim().min(1).max(120),
    deviceType,
    reason: optionalReason,
  })
  .strict();
const updateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    status: deviceStatus.optional(),
    reason: optionalReason,
  })
  .strict();
const listQuerySchema = z
  .object({
    branchId: z.string().uuid().optional(),
    status: deviceStatus.optional(),
    cursor: z.string().uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

@Controller('internal/v1/organizations/:organizationId')
@UseGuards(DeviceIntegrationServiceTokenGuard)
export class DeviceController {
  constructor(private readonly service: DeviceRegistryService) {}

  @Get('devices')
  async list(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Query() query: unknown,
  ) {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Device list query is invalid.');
    return this.service.listDevices({ organizationId, ...parsed.data });
  }

  @Get('branches/:branchId/devices/:deviceId')
  get(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
  ) {
    return this.service.getDevice(organizationId, deviceId, branchId);
  }

  @Post('branches/:branchId/devices')
  async register(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Device registration body is invalid.');
    return this.service.registerDevice(organizationId, branchId, parsed.data, commandMeta(headers));
  }

  @Patch('branches/:branchId/devices/:deviceId')
  @HttpCode(200)
  async update(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Device update body is invalid.');
    return this.service.updateDevice(
      organizationId,
      branchId,
      deviceId,
      parseVersion(ifMatch),
      parsed.data,
      commandMeta(headers),
    );
  }
}

@Controller('internal/v1/device')
export class DeviceWebhookController {
  constructor(
    private readonly service: DeviceRegistryService,
    @Inject(DEVICE_SIGNATURE_VERIFIER) private readonly signatureVerifier: DeviceSignatureVerifier,
  ) {}

  @Post('health-observations')
  @HttpCode(202)
  async reportHealth(
    @Body() body: unknown,
    @Headers('x-device-signature') signature: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    this.assertSigned(rawBody, signature);
    const schema = z
      .object({
        organizationId: z.string().uuid(),
        adapterKey,
        externalDeviceId: externalId,
        externalObservationId: externalId,
        reportedState: z.enum(['online', 'degraded', 'offline']),
        observedAt: z.string().datetime({ offset: true }),
      })
      .strict();
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Device health observation is invalid.');
    return this.service.reportHealth(
      parsed.data,
      normalizeCorrelationId(correlationId ?? request.id),
    );
  }

  @Post('events')
  @HttpCode(202)
  async importTransaction(
    @Body() body: unknown,
    @Headers('x-device-signature') signature: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    this.assertSigned(rawBody, signature);
    const schema = z.object({
      eventId: z.string().min(1).max(160),
      organizationId: z.string().uuid(),
      branchId: z.string().uuid(),
      externalCardId: z.string().min(1).max(160),
      transactionKind: z.enum(['top_up', 'spend', 'refund', 'adjustment']),
      amountMinor: z.number().int(),
      currency: z.string().length(3),
      occurredAt: z.string().datetime({ offset: true }),
      sourceDeviceId: z.string().max(160).optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Device transaction event is invalid.');
    return this.service.importTransactionEvent(
      {
        externalEventId: parsed.data.eventId,
        organizationId: parsed.data.organizationId,
        branchId: parsed.data.branchId,
        externalCardId: parsed.data.externalCardId,
        transactionKind: parsed.data.transactionKind,
        amountMinor: parsed.data.amountMinor,
        currency: parsed.data.currency,
        occurredAt: parsed.data.occurredAt,
      },
      normalizeCorrelationId(correlationId ?? request.id),
    );
  }

  private assertSigned(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): asserts rawBody is Buffer {
    if (!rawBody) throw new ServiceUnavailableException('Raw device request body is unavailable.');
    if (!this.signatureVerifier.isConfigured())
      throw new ServiceUnavailableException('Device webhook authentication is not configured.');
    if (!this.signatureVerifier.verify(rawBody, signature))
      throw new UnauthorizedException('Device signature is invalid.');
  }
}

function commandMeta(headers: Record<string, string | string[] | undefined>) {
  const single = (name: string): string | undefined => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  const caller = single('x-funtino-service-id');
  if (caller !== 'api-gateway')
    throw new BadRequestException('Authenticated service identity is missing.');
  const actorUserId = z.string().uuid().safeParse(single('x-funtino-actor-user-id'));
  const correlationId = z.string().uuid().safeParse(single('x-correlation-id'));
  const idempotencyKey = z.string().uuid().safeParse(single('idempotency-key'));
  if (!actorUserId.success || !correlationId.success || !idempotencyKey.success)
    throw new BadRequestException('Actor, correlation and idempotency headers are required.');
  return {
    callerService: 'api-gateway' as const,
    actorUserId: actorUserId.data,
    correlationId: correlationId.data,
    idempotencyKey: idempotencyKey.data,
  };
}

function parseVersion(value: string | undefined): number {
  if (!value) throw new BadRequestException('If-Match is required.');
  const normalized = value.trim().replace(/^"|"$/g, '');
  const version = Number(normalized);
  if (!Number.isInteger(version) || version < 1)
    throw new BadRequestException('If-Match must contain a positive device version.');
  return version;
}
