import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { DomainError } from '@funtino/backend-core';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import {
  EDGE_OPERATOR_PERMISSION_KEYS,
  IdentityAccessClient,
  type EdgeOperatorPermission,
} from '../../infrastructure/identity-access/identity-access.client.js';

const issueSchema = z
  .object({
    branchId: z.string().uuid(),
    permissionKeys: z.array(z.enum(EDGE_OPERATOR_PERMISSION_KEYS)).min(1).max(10),
  })
  .strict()
  .refine((value) => new Set(value.permissionKeys).size === value.permissionKeys.length);

@Controller('api/v1/operations/edge')
@UseGuards(SessionGuard, TrustedOriginGuard)
export class OperationsEdgeTokenController {
  constructor(
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly identityAccess: IdentityAccessClient,
  ) {}

  @Post('operator-token')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async issue(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(issueSchema)) body: z.infer<typeof issueSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const session = request.session;
    if (!session || session.audience !== 'management') {
      throw new DomainError('UNAUTHENTICATED', 'نشست مدیریتی معتبر نیست.');
    }
    const branch = await this.organizationBranch.getActiveBranch(body.branchId);
    const result = await this.identityAccess.issueEdgeOperatorToken(
      user.id,
      session,
      { type: 'branch', organizationId: branch.organizationId, branchId: branch.id },
      body.permissionKeys as EdgeOperatorPermission[],
      requestCorrelationId(request),
    );
    return success(result, request);
  }
}
