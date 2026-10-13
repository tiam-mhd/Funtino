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
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import { CustomerFamilySupportService } from '../../application/customer/customer-family-support.service.js';
import {
  IdentityAccessClient,
  type AccessScopeDto,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const lookupSchema = z
  .object({
    organizationId: uuid,
    branchId: uuid,
    phone: z.string().trim().min(8).max(20),
  })
  .strict();

@Controller('api/v1/operations/customer-family')
@UseGuards(SessionGuard)
export class OperationsCustomerFamilyController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly family: CustomerFamilySupportService,
  ) {}

  @Post('lookup')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  @Header('pragma', 'no-cache')
  async lookup(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(lookupSchema)) body: z.infer<typeof lookupSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = {
      type: 'branch',
      organizationId: body.organizationId,
      branchId: body.branchId,
    };
    const authorization = await this.identityAccess.evaluateAuthorization(
      user.id,
      request.session,
      {
        permission: 'customer.family.read',
        scope,
        resource: { type: 'branch', id: body.branchId },
      },
      correlationId,
    );
    if (!authorization.allowed) {
      throw new DomainError('FORBIDDEN', 'مجوز مشاهده‌ی اطلاعات خانواده در این شعبه را ندارید.');
    }
    const organization = await this.organizationBranch.getOrganization(body.organizationId);
    const branch = await this.organizationBranch.getOrganizationBranch(
      body.organizationId,
      body.branchId,
    );
    if (organization.status !== 'active' || branch.status !== 'active') {
      throw new DomainError('CONFLICT', 'مجموعه یا شعبه در وضعیت فعال نیست.');
    }
    if (branch.organizationId.toLowerCase() !== body.organizationId.toLowerCase()) {
      throw new DomainError('NOT_FOUND', 'شعبه در این مجموعه پیدا نشد.');
    }
    return success(
      await this.family.lookup({ ...body, actorUserId: user.id, correlationId }),
      request,
    );
  }
}
