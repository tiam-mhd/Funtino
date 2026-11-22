import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import {
  EDGE_OPERATOR_PERMISSION_KEYS,
  IdentityAccessClient,
  type AccessScopeDto,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { DeviceIntegrationClient } from '../../infrastructure/device-integration/device-integration.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const permissionsQuerySchema = z.object({ branchId: uuid }).strict();
const pairingApprovalSchema = z
  .object({
    code: z.string().trim().min(10).max(16),
    branchId: uuid,
    permissionKeys: z.array(z.enum(EDGE_OPERATOR_PERMISSION_KEYS)).min(1).max(10),
  })
  .strict()
  .refine((value) => new Set(value.permissionKeys).size === value.permissionKeys.length);

@Controller('api/v1/operations/edge')
@UseGuards(SessionGuard)
export class OperationsEdgePairingController {
  constructor(
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly identityAccess: IdentityAccessClient,
    private readonly devices: DeviceIntegrationClient,
  ) {}

  @Get('pairing-permissions')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async listPermissions(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(permissionsQuerySchema))
    query: z.infer<typeof permissionsQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const session = this.managementSession(request);
    const branch = await this.organizationBranch.getActiveBranch(query.branchId);
    const scope: AccessScopeDto = {
      type: 'branch',
      organizationId: branch.organizationId,
      branchId: branch.id,
    };
    const correlationId = requestCorrelationId(request);
    const results = await Promise.all(
      EDGE_OPERATOR_PERMISSION_KEYS.map(async (permission) => {
        const result = await this.identityAccess.evaluateAuthorization(
          user.id,
          session,
          { permission, scope },
          correlationId,
        );
        return result.allowed ? permission : null;
      }),
    );
    return success(
      {
        branchId: branch.id,
        permissionKeys: results.filter(
          (item): item is (typeof EDGE_OPERATOR_PERMISSION_KEYS)[number] => item !== null,
        ),
      },
      request,
    );
  }

  @Post('pairing-approvals')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async approve(
    @CurrentUser() user: { id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(pairingApprovalSchema)) body: z.infer<typeof pairingApprovalSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const session = this.managementSession(request);
    if (!idempotencyKey || !uuid.safeParse(idempotencyKey).success)
      throw new BadRequestException('A valid UUID Idempotency-Key is required.');
    const branch = await this.organizationBranch.getActiveBranch(body.branchId);
    const scope: AccessScopeDto = {
      type: 'branch',
      organizationId: branch.organizationId,
      branchId: branch.id,
    };
    const correlationId = requestCorrelationId(request);
    const checks = await Promise.all(
      body.permissionKeys.map((permission) =>
        this.identityAccess.evaluateAuthorization(
          user.id,
          session,
          { permission, scope },
          correlationId,
        ),
      ),
    );
    if (checks.some((result) => !result.allowed))
      throw new DomainError(
        'FORBIDDEN',
        'برای انتخاب همهٔ دسترسی‌های درخواست‌شده مجوز فعال ندارید.',
      );
    const result = await this.devices.approveEdgeOperatorPairing(
      {
        code: body.code,
        organizationId: branch.organizationId,
        branchId: branch.id,
        managementSessionId: session.id,
        permissionKeys: body.permissionKeys,
      },
      { actorUserId: user.id, correlationId, idempotencyKey },
    );
    return success(result, request);
  }

  private managementSession(request: AuthenticatedRequest) {
    const session = request.session;
    if (!session || session.audience !== 'management')
      throw new DomainError('UNAUTHENTICATED', 'نشست مدیریتی معتبر نیست.');
    return session;
  }
}
