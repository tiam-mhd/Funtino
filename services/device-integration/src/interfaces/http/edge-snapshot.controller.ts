import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { z } from 'zod';
import { EdgeSnapshotService } from '../../application/edge-snapshot.service.js';
import { DeviceRegistryService } from '../../application/device-registry.service.js';
import {
  DEVICE_SIGNATURE_VERIFIER,
  type DeviceSignatureVerifier,
} from '../../application/ports/device-signature-verifier.port.js';

const querySchema = z
  .object({
    branchId: z.string().uuid(),
    cursor: z.string().max(1024).optional(),
  })
  .strict();

@Controller('internal/v2/edge/snapshot')
export class EdgeSnapshotController {
  constructor(
    private readonly snapshots: EdgeSnapshotService,
    private readonly devices: DeviceRegistryService,
    @Inject(DEVICE_SIGNATURE_VERIFIER) private readonly verifier: DeviceSignatureVerifier,
  ) {}

  @Get()
  async getPage(
    @Query() rawQuery: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
  ) {
    const parsed = querySchema.safeParse(rawQuery);
    if (!parsed.success || !z.string().uuid().safeParse(installationId).success)
      throw new UnauthorizedException('Edge snapshot request identity is invalid.');
    if (!this.verifier.isEdgeConfigured())
      throw new ServiceUnavailableException('Edge authentication is not configured.');
    if (!this.verifier.verifyEdge(Buffer.alloc(0), keyId, signature))
      throw new UnauthorizedException('Edge signature is invalid.');
    const installation = await this.devices.getEdgeInstallation(installationId!);
    if (
      !installation ||
      installation.status !== 'active' ||
      (installation.currentKeyId !== keyId && installation.previousKeyId !== keyId)
    )
      throw new UnauthorizedException('Edge installation is not authorized.');
    if (!(await this.devices.consumeEdgeRequestQuota(installationId!)))
      throw new HttpException('Edge request rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);
    return this.snapshots.getPage({
      sourceInstanceId: installationId!,
      branchId: parsed.data.branchId,
      keyId: keyId!,
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
    });
  }
}
