import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  Inject,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DomainError } from '@funtino/backend-core';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import {
  IdentityAccessClient,
  EDGE_OPERATOR_PERMISSION_KEYS,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { requestCorrelationId } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';

const uuid = z.string().uuid();
const redeemSchema = z
  .object({
    pairingId: uuid,
    actorUserId: uuid,
    managementSessionId: uuid,
    organizationId: uuid,
    branchId: uuid,
    permissionKeys: z.array(z.enum(EDGE_OPERATOR_PERMISSION_KEYS)).min(1).max(10),
  })
  .strict()
  .refine((value) => new Set(value.permissionKeys).size === value.permissionKeys.length);

@Injectable()
class EdgeOperatorPairingRedemptionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const configured = process.env.EDGE_OPERATOR_PAIRING_DEVICE_INTEGRATION_TOKEN;
    const supplied = request.headers['x-funtino-service-token'];
    if (!configured || configured.length < 32 || configured.length > 512)
      throw new ServiceUnavailableException('Operator pairing redemption is not configured.');
    if (
      request.method !== 'POST' ||
      request.routeOptions.url !== '/internal/v1/edge/operator-pairings/redeem' ||
      request.headers['x-funtino-service-id'] !== 'device-integration' ||
      typeof supplied !== 'string' ||
      supplied.length < 32 ||
      supplied.length > 512 ||
      !timingSafeEqual(
        createHash('sha256').update(configured).digest(),
        createHash('sha256').update(supplied).digest(),
      )
    )
      throw new UnauthorizedException(
        'Device Integration is not authorized to redeem an operator pairing.',
      );
    return true;
  }
}

@Controller('internal/v1/edge/operator-pairings')
@UseGuards(EdgeOperatorPairingRedemptionGuard)
export class EdgeOperatorPairingRedemptionController {
  constructor(
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly identityAccess: IdentityAccessClient,
  ) {}

  @Post('redeem')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async redeem(@Body() rawBody: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = redeemSchema.safeParse(rawBody);
    if (!parsed.success)
      throw new BadRequestException('Operator pairing redemption request is invalid.');
    const input = parsed.data;
    const session = await this.store.findActiveSessionById(input.managementSessionId);
    if (
      !session ||
      session.audience !== 'management' ||
      session.userId.toLowerCase() !== input.actorUserId.toLowerCase()
    )
      throw new DomainError('UNAUTHENTICATED', 'نشست مدیریتی تأییدکننده دیگر معتبر نیست.');
    const branch = await this.organizationBranch.getActiveBranch(input.branchId);
    if (branch.organizationId.toLowerCase() !== input.organizationId.toLowerCase())
      throw new DomainError('FORBIDDEN', 'شعبهٔ تأییدشده با محدودهٔ فعال یکسان نیست.');
    const result = await this.identityAccess.issueEdgeOperatorToken(
      input.actorUserId,
      session,
      { type: 'branch', organizationId: branch.organizationId, branchId: branch.id },
      input.permissionKeys,
      requestCorrelationId(request),
    );
    const tokenExpiresAt = Date.parse(result.expiresAt);
    const tokenLifetimeMs = tokenExpiresAt - Date.now();
    if (!Number.isFinite(tokenExpiresAt) || tokenLifetimeMs <= 0 || tokenLifetimeMs > 5 * 60_000)
      throw new ServiceUnavailableException('IAM returned an invalid operator token lifetime.');
    if (
      result.branchId.toLowerCase() !== input.branchId.toLowerCase() ||
      result.permissionKeys.length !== input.permissionKeys.length ||
      result.permissionKeys.some((permission) => !input.permissionKeys.includes(permission))
    )
      throw new ServiceUnavailableException('IAM returned an unexpected operator authorization.');
    return {
      token: result.token,
      tokenId: result.tokenId,
      organizationId: branch.organizationId,
      branchId: result.branchId,
      permissionKeys: result.permissionKeys,
      expiresAt: result.expiresAt,
      policyVersion: result.policyVersion,
      catalogVersion: result.catalogVersion,
    };
  }
}
