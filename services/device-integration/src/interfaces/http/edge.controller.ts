import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { normalizeCorrelationId } from '@funtino/backend-core';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DeviceRegistryService } from '../../application/device-registry.service.js';
import {
  DEVICE_SIGNATURE_VERIFIER,
  type DeviceSignatureVerifier,
} from '../../application/ports/device-signature-verifier.port.js';
import type { EdgeTransactionEvent } from '../../application/ports/device-registry.repository.js';
import { WalletEdgeMappingClient } from '../../infrastructure/wallet/wallet-edge-mapping.client.js';

const uuid = z.string().uuid();
const edgeEventSchema: z.ZodType<EdgeTransactionEvent> = z
  .object({
    eventId: uuid,
    sourceInstanceId: uuid,
    localTransactionId: z.string().trim().min(1).max(160),
    sourceDatabase: z.string().trim().min(1).max(160),
    organizationId: uuid,
    branchId: uuid,
    cardId: uuid,
    householdId: uuid,
    memberId: uuid.nullable().optional().transform((value) => value ?? null),
    deviceId: uuid.nullable(),
    sourceDeviceId: z.string().trim().min(1).max(160).nullable(),
    transactionKind: z.enum([
      'top_up',
      'spend',
      'refund',
      'adjustment',
      'issuance',
      'card_replacement',
    ]),
    amountRial: z.number().int().safe(),
    currencyCode: z.literal('IRR'),
    grossAmountRial: z.number().int().nonnegative().safe(),
    discountAmountRial: z.number().int().nonnegative().safe(),
    netAmountRial: z.number().int().nonnegative().safe(),
    promotionId: z.string().trim().min(1).max(160).nullable(),
    ruleId: z.string().trim().min(1).max(160).nullable(),
    pricingVersion: z.string().trim().min(1).max(80).nullable(),
    reversalOfLocalTransactionId: z.string().trim().min(1).max(160).nullable().optional().transform((value) => value ?? null),
    occurredAt: z.string().datetime({ offset: true }),
    localSequence: z.number().int().positive().safe(),
    balanceAfterRial: z.number().int().nonnegative().safe().nullable(),
    operationResult: z.enum(['success', 'cancelled', 'failed']),
    snapshotVersion: z.string().trim().min(1).max(120),
  })
  .strict();

const batchSchema = z
  .object({ sourceInstanceId: uuid, events: z.array(z.unknown()).min(1).max(100) })
  .strict();
const balanceSnapshotSchema = z.object({
  sourceInstanceId: uuid,
  branchId: uuid,
  snapshotId: uuid,
  snapshotVersion: z.string().trim().min(1).max(120),
  cardId: uuid,
  householdId: uuid,
  memberId: uuid.nullable(),
  localSequence: z.number().int().nonnegative().safe(),
  balanceRial: z.number().int().nonnegative().safe(),
  currencyCode: z.literal('IRR'),
  observedAt: z.string().datetime({ offset: true }),
}).strict();

@Controller('internal/v2/edge')
export class EdgeController {
  constructor(
    private readonly service: DeviceRegistryService,
    @Inject(DEVICE_SIGNATURE_VERIFIER) private readonly signatureVerifier: DeviceSignatureVerifier,
    private readonly wallet: WalletEdgeMappingClient,
  ) {}

  @Post('events')
  @HttpCode(200)
  async ingestEvents(
    @Body() rawBodyValue: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!rawBody) throw new ServiceUnavailableException('Raw Edge request body is unavailable.');
    if (!this.signatureVerifier.isEdgeConfigured())
      throw new ServiceUnavailableException('Edge authentication is not configured.');
    if (!this.signatureVerifier.verifyEdge(rawBody, keyId, signature))
      throw new UnauthorizedException('Edge signature is invalid.');
    if (!uuid.safeParse(installationId).success)
      throw new UnauthorizedException('Edge installation identity is invalid.');

    const batch = batchSchema.safeParse(rawBodyValue);
    if (!batch.success) throw new BadRequestException('Edge event batch is invalid.');

    const events = batch.data.events.map((rawEvent) => {
      const parsed = edgeEventSchema.safeParse(rawEvent);
      if (parsed.success) return parsed.data;
      const eventIdentity = z.object({ eventId: uuid }).safeParse(rawEvent);
      return { invalidEventId: eventIdentity.success ? eventIdentity.data.eventId : null };
    });
    if (batch.data.sourceInstanceId !== installationId) {
      return {
        results: events.map((event) => ({
          status: 'rejected' as const,
          eventId: 'eventId' in event ? event.eventId : event.invalidEventId,
          errorCode: 'INSTALLATION_SCOPE_MISMATCH',
          retryable: false,
        })),
      };
    }
    const results = await this.service.importEdgeEvents({
      sourceInstanceId: installationId!,
      keyId: keyId!,
      events,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
    });
    return { results };
  }

  @Post('balances/reconcile')
  @HttpCode(200)
  async reconcilePhysicalBalance(
    @Body() rawBodyValue: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!rawBody) throw new ServiceUnavailableException('Raw Edge request body is unavailable.');
    if (!this.signatureVerifier.isEdgeConfigured())
      throw new ServiceUnavailableException('Edge authentication is not configured.');
    if (!this.signatureVerifier.verifyEdge(rawBody, keyId, signature))
      throw new UnauthorizedException('Edge signature is invalid.');
    if (!uuid.safeParse(installationId).success)
      throw new UnauthorizedException('Edge installation identity is invalid.');

    const parsed = balanceSnapshotSchema.safeParse(rawBodyValue);
    if (!parsed.success) throw new BadRequestException('Physical balance snapshot is invalid.');
    const installation = await this.service.getEdgeInstallation(installationId!);
    if (!installation || installation.status !== 'active' ||
      (installation.currentKeyId !== keyId && installation.previousKeyId !== keyId) ||
      parsed.data.sourceInstanceId !== installation.sourceInstanceId || parsed.data.branchId !== installation.branchId)
      throw new UnauthorizedException('Edge installation is not authorized for this balance snapshot.');
    if (!(await this.service.consumeEdgeRequestQuota(installationId!)))
      throw new HttpException('Edge request rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);

    return this.wallet.reconcileBalanceSnapshot({
      ...parsed.data,
      organizationId: installation.organizationId,
    });
  }
}
