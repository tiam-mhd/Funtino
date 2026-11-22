import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Header,
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
import { EdgeOperatorPairingService } from '../../application/edge-operator-pairing.service.js';
import {
  DEVICE_SIGNATURE_VERIFIER,
  type DeviceSignatureVerifier,
} from '../../application/ports/device-signature-verifier.port.js';
import { EdgeOperatorPairingGatewayClient } from '../../infrastructure/gateway/edge-operator-pairing.client.js';

const uuid = z.string().uuid();
const startSchema = z.object({}).strict();
const pollSchema = z.object({ pairingId: uuid, pollSecret: z.string().min(32).max(128) }).strict();
const cancelSchema = pollSchema;

@Controller('internal/v2/edge/operator-pairings')
export class EdgeOperatorPairingController {
  constructor(
    private readonly registry: DeviceRegistryService,
    private readonly pairings: EdgeOperatorPairingService,
    private readonly gateway: EdgeOperatorPairingGatewayClient,
    @Inject(DEVICE_SIGNATURE_VERIFIER) private readonly signatureVerifier: DeviceSignatureVerifier,
  ) {}

  @Post()
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  @HttpCode(HttpStatus.CREATED)
  async start(
    @Body() rawBodyValue: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const rawBody = this.rawBody(request);
    const installation = await this.authorize(rawBody, installationId, keyId, signature);
    if (!startSchema.safeParse(rawBodyValue).success)
      throw new BadRequestException('Operator pairing request is invalid.');
    return this.pairings.start({
      sourceInstanceId: installation.sourceInstanceId,
      organizationId: installation.organizationId,
      branchId: installation.branchId,
    });
  }

  @Post('poll')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  @HttpCode(HttpStatus.OK)
  async poll(
    @Body() rawBodyValue: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const rawBody = this.rawBody(request);
    const installation = await this.authorize(rawBody, installationId, keyId, signature);
    const parsed = pollSchema.safeParse(rawBodyValue);
    if (!parsed.success) throw new BadRequestException('Operator pairing poll request is invalid.');
    const input = {
      id: parsed.data.pairingId,
      pollSecret: parsed.data.pollSecret,
      sourceInstanceId: installation.sourceInstanceId,
    };
    const state = await this.pairings.inspect(input);
    if (state.status !== 'approved') return state;
    const claimed = await this.pairings.claim(input);
    if (!claimed) return this.pairings.inspect(input);
    const requestId = normalizeCorrelationId(correlationId ?? request.id);
    try {
      const operatorToken = await this.gateway.redeem(claimed);
      const recorded = await this.pairings.markIssued({
        pairing: claimed,
        tokenId: operatorToken.tokenId,
        expiresAt: operatorToken.expiresAt,
        correlationId: requestId,
      });
      if (!recorded) throw new Error('Pairing state changed.');
      return { status: 'authorized', operatorToken };
    } catch {
      await this.pairings.markFailed(claimed.id).catch(() => undefined);
      throw new ServiceUnavailableException('صدور مجوز کامل نشد. اتصال را دوباره آغاز کنید.');
    }
  }

  @Post('cancel')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Body() rawBodyValue: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const rawBody = this.rawBody(request);
    const installation = await this.authorize(rawBody, installationId, keyId, signature);
    const parsed = cancelSchema.safeParse(rawBodyValue);
    if (!parsed.success) throw new BadRequestException('Operator pairing cancellation is invalid.');
    return this.pairings.cancel({
      id: parsed.data.pairingId,
      pollSecret: parsed.data.pollSecret,
      sourceInstanceId: installation.sourceInstanceId,
    });
  }

  private rawBody(request: FastifyRequest) {
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!rawBody) throw new ServiceUnavailableException('Raw Edge request body is unavailable.');
    return rawBody;
  }

  private async authorize(
    rawBody: Buffer,
    installationId: string | undefined,
    keyId: string | undefined,
    signature: string | undefined,
  ) {
    if (!this.signatureVerifier.isEdgeConfigured())
      throw new ServiceUnavailableException('Edge authentication is not configured.');
    if (!this.signatureVerifier.verifyEdge(rawBody, keyId, signature))
      throw new UnauthorizedException('Edge signature is invalid.');
    if (!uuid.safeParse(installationId).success)
      throw new UnauthorizedException('Edge installation identity is invalid.');
    const installation = await this.registry.getEdgeInstallation(installationId!);
    if (
      !installation ||
      installation.status !== 'active' ||
      (installation.currentKeyId !== keyId && installation.previousKeyId !== keyId)
    )
      throw new UnauthorizedException('Edge installation is not authorized.');
    if (!(await this.registry.consumeEdgeRequestQuota(installationId!)))
      throw new HttpException('Edge request rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);
    return installation;
  }
}
