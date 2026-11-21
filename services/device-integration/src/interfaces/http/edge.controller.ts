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
import {
  edgeEventBatchRequestSchema as batchSchema,
  edgeIngestResponseSchema,
  edgeTransactionPayloadSchema as edgeEventSchema,
} from '@funtino/event-contracts';
import { z } from 'zod';
import { DeviceRegistryService } from '../../application/device-registry.service.js';
import {
  DEVICE_SIGNATURE_VERIFIER,
  type DeviceSignatureVerifier,
} from '../../application/ports/device-signature-verifier.port.js';
import { WalletEdgeMappingClient } from '../../infrastructure/wallet/wallet-edge-mapping.client.js';

const uuid = z.string().uuid();
const balanceSnapshotSchema = z
  .object({
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
  })
  .strict();

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
    const response = edgeIngestResponseSchema.safeParse({ results });
    if (!response.success || response.data.results.length !== batch.data.events.length) {
      throw new ServiceUnavailableException('Edge event acknowledgement could not be validated.');
    }
    return response.data;
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
    if (
      !installation ||
      installation.status !== 'active' ||
      (installation.currentKeyId !== keyId && installation.previousKeyId !== keyId) ||
      parsed.data.sourceInstanceId !== installation.sourceInstanceId ||
      parsed.data.branchId !== installation.branchId
    )
      throw new UnauthorizedException(
        'Edge installation is not authorized for this balance snapshot.',
      );
    if (!(await this.service.consumeEdgeRequestQuota(installationId!)))
      throw new HttpException('Edge request rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);

    return this.wallet.reconcileBalanceSnapshot({
      ...parsed.data,
      organizationId: installation.organizationId,
    });
  }
}
