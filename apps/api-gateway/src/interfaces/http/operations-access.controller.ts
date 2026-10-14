import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import { AuthService } from '../../application/auth/auth.service.js';
import { IdentityAccessClient } from '../../infrastructure/identity-access/identity-access.client.js';
import type { AccessScopeDto } from '../../infrastructure/identity-access/identity-access.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const rolesQuerySchema = z
  .object({
    scopeType: z.enum(['global', 'organization', 'branch']).optional(),
    organizationId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    cursor: z.string().uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .superRefine((value, context) => {
    const type =
      value.scopeType ??
      (value.branchId ? 'branch' : value.organizationId ? 'organization' : undefined);
    if (!type)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'A valid scope is required.' });
    if (type === 'global' && (value.organizationId || value.branchId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Global scope cannot include organization identifiers.',
      });
    if (type !== 'global' && !value.organizationId)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Organization scope is required.' });
    if (type === 'branch' && !value.branchId)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Branch scope is required.' });
    if (type !== 'branch' && value.branchId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Branch identifier requires branch scope.',
      });
  });
const auditQuerySchema = z
  .object({
    scopeType: z.enum(['global', 'organization', 'branch']).optional(),
    organizationId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    cursor: z.string().min(1).max(128).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .superRefine((value, context) => {
    const type =
      value.scopeType ??
      (value.branchId ? 'branch' : value.organizationId ? 'organization' : undefined);
    if (!type)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'A valid scope is required.' });
    if (type === 'global' && (value.organizationId || value.branchId))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Global scope cannot include organization identifiers.',
      });
    if (type !== 'global' && !value.organizationId)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Organization scope is required.' });
    if (type === 'branch' && !value.branchId)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Branch scope is required.' });
    if (type !== 'branch' && value.branchId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Branch identifier requires branch scope.',
      });
  });
const uuid = z.string().uuid();
const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z.object({ type: z.literal('organization'), organizationId: uuid }).strict(),
  z.object({ type: z.literal('branch'), organizationId: uuid, branchId: uuid }).strict(),
]);
const reasonSchema = z.object({ reason: z.string().trim().min(8).max(500) }).strict();
const optionalReasonSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict();
const roleCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    scope: scopeSchema,
    permissionKeys: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(100)
      .refine((items) => new Set(items).size === items.length),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
const roleUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    permissionKeys: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(100)
      .refine((items) => new Set(items).size === items.length)
      .optional(),
    status: z.enum(['active', 'disabled']).optional(),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.name === undefined &&
      value.permissionKeys === undefined &&
      value.status === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one role field is required.',
      });
    }
    if ((value.permissionKeys !== undefined || value.status !== undefined) && !value.reason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'A reason is required when effective role access changes.',
      });
    }
  });
const invitationCreateSchema = z
  .object({
    phoneE164: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    scope: scopeSchema,
    roleId: uuid,
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict();
const membershipRoleSchema = z
  .object({ roleId: uuid, reason: z.string().trim().min(8).max(500) })
  .strict();
const overrideCreateSchema = z
  .object({
    permission: z.string().min(1).max(120),
    effect: z.enum(['allow', 'deny']),
    scope: scopeSchema,
    resource: z
      .object({ type: z.string().trim().min(1).max(80), id: z.string().trim().min(1).max(160) })
      .strict()
      .optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
type RolesQuery = z.infer<typeof rolesQuerySchema>;
type AuditQuery = z.infer<typeof auditQuerySchema>;

@Controller('api/v1/operations')
@UseGuards(SessionGuard)
export class OperationsAccessController {
  private readonly logger = new Logger(OperationsAccessController.name);

  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly auth: AuthService,
    private readonly organizationBranch: OrganizationBranchClient,
  ) {}

  @Get('access-context')
  async accessContext(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    const context = await this.identityAccess.currentAccessContext(
      user.id,
      requestCorrelationId(request),
    );
    return success(context, request);
  }

  @Get('permissions')
  async permissions(@Req() request: AuthenticatedRequest) {
    const catalog = await this.identityAccess.permissionCatalog(requestCorrelationId(request));
    return {
      status: 'success' as const,
      data: catalog.data,
      catalogVersion: catalog.catalogVersion,
      meta: {
        requestId: request.requestId ?? null,
        correlationId: request.correlationId ?? null,
      },
    };
  }

  @Get('roles')
  async roles(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(rolesQuerySchema)) query: RolesQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const roles = await this.identityAccess.listRolesInScope(
      user.id,
      this.queryScope(query),
      requestCorrelationId(request),
      { cursor: query.cursor, pageSize: query.pageSize },
    );
    return {
      status: 'success' as const,
      data: roles.data,
      nextCursor: roles.nextCursor,
      meta: {
        requestId: request.requestId ?? null,
        correlationId: request.correlationId ?? null,
      },
    };
  }

  @Get('roles/templates')
  async roleTemplates(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(rolesQuerySchema)) query: RolesQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.roleTemplates(
        user.id,
        this.queryScope(query),
        requestCorrelationId(request),
      ),
      request,
    );
  }

  @Post('roles')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  async createRole(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(roleCreateSchema)) body: z.infer<typeof roleCreateSchema>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.createRole(
        user.id,
        this.session(request),
        requestCorrelationId(request),
        this.idempotencyKey(idempotencyKey),
        body,
      ),
      request,
    );
  }

  @Patch('roles/:roleId')
  @UseGuards(TrustedOriginGuard)
  async updateRole(
    @CurrentUser() user: { id: string },
    @Param('roleId') roleId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(roleUpdateSchema)) body: z.infer<typeof roleUpdateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.updateRole(
        user.id,
        this.session(request),
        roleId,
        this.expectedVersion(ifMatch),
        requestCorrelationId(request),
        this.idempotencyKey(idempotencyKey),
        body,
      ),
      request,
    );
  }

  @Get('staff')
  async staff(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(rolesQuerySchema)) query: RolesQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const page = await this.identityAccess.listStaff(
      user.id,
      this.queryScope(query),
      requestCorrelationId(request),
      { cursor: query.cursor, pageSize: query.pageSize },
    );
    const identities = await this.auth.getUserIdentitySummaries(
      page.data.map((member) => member.userId),
    );
    const identitiesByUserId = new Map(identities.map((identity) => [identity.userId, identity]));
    return success(
      {
        ...page,
        data: page.data.map((member) => ({
          ...member,
          ...(identitiesByUserId.get(member.userId)
            ? {
                identity: {
                  displayName: identitiesByUserId.get(member.userId)!.displayName,
                  firstName: identitiesByUserId.get(member.userId)!.firstName,
                  lastName: identitiesByUserId.get(member.userId)!.lastName,
                },
              }
            : { identity: null }),
        })),
      },
      request,
    );
  }

  @Get('staff/invitations')
  async scopedInvitations(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(rolesQuerySchema)) query: RolesQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.listScopedInvitations(
        user.id,
        this.queryScope(query),
        requestCorrelationId(request),
        { cursor: query.cursor, pageSize: query.pageSize },
      ),
      request,
    );
  }

  @Post('staff/invitations')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async inviteStaff(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(invitationCreateSchema))
    body: z.infer<typeof invitationCreateSchema>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.inviteStaff(
        user.id,
        this.session(request),
        requestCorrelationId(request),
        this.idempotencyKey(idempotencyKey),
        body,
      ),
      request,
    );
  }

  @Get('staff/invitations/pending')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async pendingInvitations(
    @CurrentUser() user: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    const verifiedUser = await this.auth.getMe(user.id);
    const invitations = await this.identityAccess.pendingInvitations(
      user.id,
      this.session(request),
      verifiedUser.phoneE164,
      requestCorrelationId(request),
    );
    const data = await this.describeInvitationScopes(invitations.data);
    return success({ data }, request);
  }

  @Post('staff/invitations/:invitationId/accept')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @CurrentUser() user: { id: string },
    @Param('invitationId') invitationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const verifiedUser = await this.auth.getMe(user.id);
    return success(
      await this.identityAccess.acceptInvitation(
        user.id,
        this.session(request),
        invitationId,
        verifiedUser.phoneE164,
        requestCorrelationId(request),
        this.idempotencyKey(idempotencyKey),
      ),
      request,
    );
  }

  @Post('staff/invitations/:invitationId/revoke')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async revokeInvitation(
    @CurrentUser() user: { id: string },
    @Param('invitationId') invitationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.revokeInvitation(
        user.id,
        this.session(request),
        invitationId,
        body.reason,
        requestCorrelationId(request),
        this.idempotencyKey(idempotencyKey),
      ),
      request,
    );
  }

  @Patch('staff/:membershipId')
  @UseGuards(TrustedOriginGuard)
  async updateMembershipRole(
    @CurrentUser() user: { id: string },
    @Param('membershipId') membershipId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(membershipRoleSchema)) body: z.infer<typeof membershipRoleSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.updateMembershipRole(
        user.id,
        this.session(request),
        membershipId,
        this.expectedVersion(ifMatch),
        body.roleId,
        body.reason,
        requestCorrelationId(request),
        this.idempotencyKey(idempotencyKey),
      ),
      request,
    );
  }

  @Post('staff/:membershipId/suspend')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async suspendStaff(
    @CurrentUser() user: { id: string },
    @Param('membershipId') membershipId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.changeMembershipStatus(
        user.id,
        this.session(request),
        membershipId,
        'suspend',
        body.reason,
        requestCorrelationId(request),
        this.idempotencyKey(key),
      ),
      request,
    );
  }

  @Post('staff/:membershipId/reactivate')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async reactivateStaff(
    @CurrentUser() user: { id: string },
    @Param('membershipId') membershipId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.changeMembershipStatus(
        user.id,
        this.session(request),
        membershipId,
        'reactivate',
        body.reason,
        requestCorrelationId(request),
        this.idempotencyKey(key),
      ),
      request,
    );
  }

  @Post('staff/:membershipId/revoke')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async revokeStaff(
    @CurrentUser() user: { id: string },
    @Param('membershipId') membershipId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.changeMembershipStatus(
        user.id,
        this.session(request),
        membershipId,
        'revoke',
        body.reason,
        requestCorrelationId(request),
        this.idempotencyKey(key),
      ),
      request,
    );
  }

  @Get('staff/:membershipId/permission-overrides')
  async listOverrides(
    @CurrentUser() user: { id: string },
    @Param('membershipId') membershipId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.listOverrides(user.id, membershipId, requestCorrelationId(request)),
      request,
    );
  }

  @Put('staff/:membershipId/permission-overrides')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  async createOverride(
    @CurrentUser() user: { id: string },
    @Param('membershipId') membershipId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(overrideCreateSchema)) body: z.infer<typeof overrideCreateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.createOverride(
        user.id,
        this.session(request),
        membershipId,
        requestCorrelationId(request),
        this.idempotencyKey(key),
        body,
      ),
      request,
    );
  }

  @Delete('staff/:membershipId/permission-overrides/:overrideId')
  @UseGuards(TrustedOriginGuard)
  async revokeOverride(
    @CurrentUser() user: { id: string },
    @Param('membershipId') membershipId: string,
    @Param('overrideId') overrideId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.revokeOverride(
        user.id,
        this.session(request),
        membershipId,
        overrideId,
        body.reason,
        requestCorrelationId(request),
        this.idempotencyKey(key),
      ),
      request,
    );
  }

  @Get('audit')
  async audit(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.identityAccess.listAudit(
        user.id,
        this.session(request),
        this.queryScope(query),
        requestCorrelationId(request),
        { cursor: query.cursor, pageSize: query.pageSize },
      ),
      request,
    );
  }

  private session(request: AuthenticatedRequest) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    return request.session;
  }

  private queryScope(
    query: Pick<RolesQuery, 'scopeType' | 'organizationId' | 'branchId'>,
  ): AccessScopeDto {
    const type =
      query.scopeType ??
      (query.branchId ? 'branch' : query.organizationId ? 'organization' : 'global');
    if (type === 'global') return { type: 'global' };
    if (!query.organizationId) throw new BadRequestException('Organization scope is required.');
    if (type === 'organization')
      return { type: 'organization', organizationId: query.organizationId };
    if (!query.branchId) throw new BadRequestException('Branch scope is required.');
    return { type: 'branch', organizationId: query.organizationId, branchId: query.branchId };
  }

  private idempotencyKey(value: string | undefined): string {
    if (!value || value.length < 16 || value.length > 128)
      throw new BadRequestException('A valid Idempotency-Key is required.');
    return value;
  }

  private expectedVersion(value: string | undefined): number {
    const match = /^"([1-9][0-9]*)"$/.exec(value ?? '');
    const version = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(version))
      throw new BadRequestException('A quoted If-Match version is required.');
    return version;
  }

  private async describeInvitationScopes(
    invitations: Awaited<ReturnType<IdentityAccessClient['pendingInvitations']>>['data'],
  ) {
    type ResourceSummary = {
      id: string;
      name: string;
      status: 'active' | 'suspended' | 'archived';
    };
    type BranchSummary = ResourceSummary & { organizationId: string };
    const organizations = new Map<string, Promise<ResourceSummary | null>>();
    const branches = new Map<string, Promise<BranchSummary | null>>();
    let ownerLookupFailed = false;

    const loadOrganization = (organizationId: string) => {
      const existing = organizations.get(organizationId);
      if (existing) return existing;
      const pending = this.organizationBranch
        .getOrganization(organizationId)
        .then(({ id, name, status }) => ({ id, name, status }))
        .catch((failure: unknown) => {
          if (!(failure instanceof DomainError && failure.code === 'NOT_FOUND')) {
            ownerLookupFailed = true;
          }
          return null;
        });
      organizations.set(organizationId, pending);
      return pending;
    };

    const loadBranch = (organizationId: string, branchId: string) => {
      const key = `${organizationId}:${branchId}`;
      const existing = branches.get(key);
      if (existing) return existing;
      const pending = this.organizationBranch
        .getOrganizationBranch(organizationId, branchId)
        .then(({ id, organizationId: parentId, name, status }) => ({
          id,
          organizationId: parentId,
          name,
          status,
        }))
        .catch((failure: unknown) => {
          if (!(failure instanceof DomainError && failure.code === 'NOT_FOUND')) {
            ownerLookupFailed = true;
          }
          return null;
        });
      branches.set(key, pending);
      return pending;
    };

    const described = await mapWithConcurrency(invitations, 4, async (invitation) => {
      if (invitation.scope.type === 'global') {
        return {
          ...invitation,
          organizationName: null,
          branchName: null,
          scopeStatus: 'system_only' as const,
        };
      }
      const organization = await loadOrganization(invitation.scope.organizationId);
      if (invitation.scope.type === 'organization') {
        return {
          ...invitation,
          organizationName: organization?.name ?? null,
          branchName: null,
          scopeStatus: organization
            ? organization.status === 'active'
              ? 'active'
              : 'inactive'
            : 'unavailable',
        };
      }

      const branch = await loadBranch(invitation.scope.organizationId, invitation.scope.branchId);
      const parentMatches = branch?.organizationId === invitation.scope.organizationId;
      const validOwnerScope = Boolean(
        organization &&
          parentMatches &&
          organization.status === 'active' &&
          branch?.status === 'active',
      );
      return {
        ...invitation,
        organizationName: organization?.name ?? null,
        branchName: parentMatches ? (branch?.name ?? null) : null,
        scopeStatus:
          !organization || !branch || !parentMatches
            ? 'unavailable'
            : validOwnerScope
              ? 'active'
              : 'inactive',
      };
    });
    if (ownerLookupFailed) {
      this.logger.warn(
        'One or more invitation scopes could not be confirmed by the owner service.',
      );
    }
    return described;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await map(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
