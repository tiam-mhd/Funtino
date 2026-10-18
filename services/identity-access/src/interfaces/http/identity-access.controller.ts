import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AccessManagementService,
  type AccessCommandMeta,
} from '../../application/access-management.service.js';
import { AccessPolicyService } from '../../application/access-policy.service.js';
import { MfaService, type MfaContext } from '../../application/mfa.service.js';
import { ServiceTokenGuard } from './service-token.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const accessScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z.object({ type: z.literal('organization'), organizationId: uuid }).strict(),
  z.object({ type: z.literal('branch'), organizationId: uuid, branchId: uuid }).strict(),
]);
const authorizationRequestSchema = z
  .object({
    permission: z.string().min(1).max(120),
    scope: accessScopeSchema,
    resource: z
      .object({ type: z.string().min(1).max(80), id: z.string().min(1).max(160) })
      .strict()
      .optional(),
    mfa: z
      .object({
        verifiedAt: z.string().datetime({ offset: true }),
        factorVersion: z.number().int().positive(),
        method: z.enum(['totp', 'recovery']),
      })
      .strict()
      .optional(),
  })
  .strict();
const mfaCodeSchema = z
  .object({ method: z.enum(['totp', 'recovery']), code: z.string().min(6).max(35) })
  .strict();
const totpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const scopedQueryFields = {
  scopeType: z.enum(['global', 'organization', 'branch']).optional(),
  organizationId: uuid.optional(),
  branchId: uuid.optional(),
  cursor: uuid.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
const validateScopeQuery = (
  value: { scopeType?: 'global' | 'organization' | 'branch'; organizationId?: string; branchId?: string },
  context: z.RefinementCtx,
) => {
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
};
const scopedQuerySchema = z.object(scopedQueryFields).strict().superRefine(validateScopeQuery);
const rolesQuerySchema = z
  .object({
    ...scopedQueryFields,
    search: z.string().trim().min(1).max(80).optional(),
    lifecycle: z.enum(['active', 'disabled', 'deleted']).optional(),
    kind: z.enum(['custom', 'system']).optional(),
  })
  .strict()
  .superRefine(validateScopeQuery);
const staffQuerySchema = z
  .object({ ...scopedQueryFields, roleId: uuid.optional() })
  .strict()
  .superRefine(validateScopeQuery);
const auditQuerySchema = z
  .object({
    scopeType: z.enum(['global', 'organization', 'branch']).optional(),
    organizationId: uuid.optional(),
    branchId: uuid.optional(),
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
const reasonSchema = z.object({ reason: z.string().trim().min(8).max(500) }).strict();
const optionalReason = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => value || undefined);
const optionalReasonSchema = z.object({ reason: optionalReason }).strict();
const managementSessionPolicySchema = z
  .object({
    managementSessionTtlHours: z.number().int().min(1).max(12),
    reason: optionalReason,
  })
  .strict();
const roleCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    scope: accessScopeSchema,
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
    reason: optionalReason,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined || value.permissionKeys !== undefined || value.status !== undefined,
  );
const invitationCreateSchema = z
  .object({
    phoneE164: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
    scope: accessScopeSchema,
    roleId: uuid,
    reason: optionalReason,
  })
  .strict();
const phoneOnlySchema = z.object({ phoneE164: z.string().regex(/^\+[1-9][0-9]{7,14}$/) }).strict();
const membershipRoleSchema = z
  .object({ roleId: uuid, reason: z.string().trim().min(8).max(500) })
  .strict();
const overrideCreateSchema = z
  .object({
    permission: z.string().min(1).max(120),
    effect: z.enum(['allow', 'deny']),
    scope: accessScopeSchema,
    resource: z
      .object({ type: z.string().trim().min(1).max(80), id: z.string().trim().min(1).max(160) })
      .strict()
      .optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
type AuthorizationRequestDto = z.infer<typeof authorizationRequestSchema>;
type RolesQueryDto = z.infer<typeof rolesQuerySchema>;
type StaffQueryDto = z.infer<typeof staffQuerySchema>;
type ScopedQueryDto = z.infer<typeof scopedQuerySchema>;
type AuditQueryDto = z.infer<typeof auditQuerySchema>;
type MfaCodeDto = z.infer<typeof mfaCodeSchema>;
type AccessScopeDto = z.infer<typeof accessScopeSchema>;

@Controller('internal/v1')
@UseGuards(ServiceTokenGuard)
export class IdentityAccessController {
  constructor(
    private readonly accessPolicy: AccessPolicyService,
    private readonly mfa: MfaService,
    private readonly accessManagement: AccessManagementService,
  ) {}

  @Get('permissions')
  permissions() {
    return this.accessPolicy.permissionCatalog();
  }

  @Post('authorization/evaluate')
  async evaluate(
    @Headers('x-funtino-actor-user-id') rawActorUserId: string | undefined,
    @Headers('x-funtino-session-id') rawSessionId: string | undefined,
    @Headers('x-correlation-id') rawCorrelationId: string | undefined,
    @Body(new ZodValidationPipe(authorizationRequestSchema)) body: AuthorizationRequestDto,
  ) {
    const actorUserId = uuid.safeParse(rawActorUserId);
    if (!actorUserId.success) throw new UnauthorizedException('Actor context is missing.');
    if (!rawCorrelationId || rawCorrelationId.length > 128) {
      throw new BadRequestException('A valid correlation ID is required.');
    }
    const { mfa: stepUp, ...request } = body;
    if (stepUp && !uuid.safeParse(rawSessionId).success) {
      throw new UnauthorizedException('A verified session context is required for MFA step-up.');
    }
    return this.accessPolicy.evaluate(
      actorUserId.data,
      request,
      stepUp
        ? {
            verifiedAt: new Date(stepUp.verifiedAt),
            factorVersion: stepUp.factorVersion,
            method: stepUp.method,
          }
        : undefined,
    );
  }

  @Get('mfa/status')
  mfaStatus(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-funtino-session-id') session: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
  ) {
    return this.mfa.status(this.mfaContext(actor, session, correlation));
  }

  @Post('mfa/enrollment/start')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  startMfaEnrollment(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-funtino-session-id') session: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
  ) {
    return this.mfa.startEnrollment(this.mfaContext(actor, session, correlation));
  }

  @Post('mfa/enrollment/confirm')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  confirmMfaEnrollment(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-funtino-session-id') session: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: { code: string },
  ) {
    return this.mfa.confirmEnrollment(this.mfaContext(actor, session, correlation), body.code);
  }

  @Post('mfa/step-up/verify')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  verifyMfaStepUp(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-funtino-session-id') session: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
    @Body(new ZodValidationPipe(mfaCodeSchema)) body: MfaCodeDto,
  ) {
    return this.mfa.verifyStepUp(this.mfaContext(actor, session, correlation), body);
  }

  @Post('mfa/recovery-codes/regenerate')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  regenerateMfaRecoveryCodes(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-funtino-session-id') session: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
    @Body(new ZodValidationPipe(mfaCodeSchema)) body: MfaCodeDto,
  ) {
    return this.mfa.regenerateRecoveryCodes(this.mfaContext(actor, session, correlation), body);
  }

  @Post('mfa/disable')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  disableMfa(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-funtino-session-id') session: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
    @Body(new ZodValidationPipe(mfaCodeSchema)) body: MfaCodeDto,
  ) {
    return this.mfa.disable(this.mfaContext(actor, session, correlation), body);
  }

  @Get('staff/memberships/current')
  currentMemberships(@Headers('x-funtino-actor-user-id') rawActorUserId: string | undefined) {
    const actorUserId = uuid.safeParse(rawActorUserId);
    if (!actorUserId.success) throw new UnauthorizedException('Actor context is missing.');
    return this.accessPolicy.currentMemberships(actorUserId.data);
  }

  @Get('system/management-session-policy')
  managementSessionPolicy(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
  ) {
    return this.accessPolicy.managementSessionPolicy(
      this.actor(actor),
      this.correlation(correlation),
    );
  }

  @Put('system/management-session-policy')
  updateManagementSessionPolicy(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(managementSessionPolicySchema))
    body: z.infer<typeof managementSessionPolicySchema>,
  ) {
    return this.accessManagement.updateManagementSessionPolicy(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      body,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Get('roles')
  roles(
    @Headers('x-funtino-actor-user-id') rawActorUserId: string | undefined,
    @Headers('x-correlation-id') rawCorrelationId: string | undefined,
    @Query(new ZodValidationPipe(rolesQuerySchema)) query: RolesQueryDto,
  ) {
    const actorUserId = uuid.safeParse(rawActorUserId);
    if (!actorUserId.success) throw new UnauthorizedException('Actor context is missing.');
    return this.accessPolicy.listRolesInScope(
      actorUserId.data,
      this.queryScope(query),
      {
        cursor: query.cursor,
        pageSize: query.pageSize,
        search: query.search,
        lifecycle: query.lifecycle,
        kind: query.kind,
      },
      this.correlation(rawCorrelationId),
    );
  }

  @Get('roles/templates')
  roleTemplates(
    @Headers('x-funtino-actor-user-id') rawActorUserId: string | undefined,
    @Headers('x-correlation-id') rawCorrelationId: string | undefined,
    @Query(new ZodValidationPipe(scopedQuerySchema)) query: ScopedQueryDto,
  ) {
    return this.accessPolicy.roleTemplates(
      this.actor(rawActorUserId),
      this.queryScope(query),
      this.correlation(rawCorrelationId),
    );
  }

  @Get('roles/:roleId')
  getRole(
    @Param('roleId', new ZodValidationPipe(uuid)) roleId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query(new ZodValidationPipe(scopedQuerySchema)) query: ScopedQueryDto,
  ) {
    return this.accessPolicy.getRoleInScope(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(roleId),
      this.queryScope(query),
      this.correlation(this.header(headers, 'x-correlation-id')),
    );
  }

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  createRole(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(roleCreateSchema)) body: z.infer<typeof roleCreateSchema>,
  ) {
    return this.accessManagement.createRole(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      body,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Patch('roles/:roleId')
  updateRole(
    @Param('roleId', new ZodValidationPipe(uuid)) roleId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(roleUpdateSchema)) body: z.infer<typeof roleUpdateSchema>,
  ) {
    return this.accessManagement.updateRole(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(roleId),
      body,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Post('roles/:roleId/restore')
  restoreRole(
    @Param('roleId', new ZodValidationPipe(uuid)) roleId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.accessManagement.restoreRole(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(roleId),
      body.reason,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Delete('roles/:roleId')
  deleteRole(
    @Param('roleId', new ZodValidationPipe(uuid)) roleId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.accessManagement.deleteRole(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(roleId),
      body.reason,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Get('staff')
  staff(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query(new ZodValidationPipe(staffQuerySchema)) query: StaffQueryDto,
  ) {
    return this.accessManagement.listStaff(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.queryScope(query),
      { cursor: query.cursor, pageSize: query.pageSize, roleId: query.roleId },
      { correlationId: this.correlation(this.header(headers, 'x-correlation-id')) },
    );
  }

  @Post('staff/invitations')
  @HttpCode(HttpStatus.ACCEPTED)
  inviteStaff(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(invitationCreateSchema))
    body: z.infer<typeof invitationCreateSchema>,
  ) {
    return this.accessManagement.inviteStaff(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      body,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Get('staff/invitations')
  scopedInvitations(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query(new ZodValidationPipe(scopedQuerySchema)) query: ScopedQueryDto,
  ) {
    return this.accessManagement.listScopedInvitations(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.queryScope(query),
      { cursor: query.cursor, pageSize: query.pageSize },
      this.correlation(this.header(headers, 'x-correlation-id')),
    );
  }

  @Post('staff/invitations/pending')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store, private')
  pendingInvitations(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(phoneOnlySchema)) body: z.infer<typeof phoneOnlySchema>,
  ) {
    this.mfaContext(
      this.header(headers, 'x-funtino-actor-user-id'),
      this.header(headers, 'x-funtino-session-id'),
      this.header(headers, 'x-correlation-id'),
    );
    return this.accessManagement.listPendingInvitations(body.phoneE164);
  }

  @Post('staff/invitations/:invitationId/accept')
  @HttpCode(HttpStatus.OK)
  acceptInvitation(
    @Param('invitationId') invitationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(phoneOnlySchema)) body: z.infer<typeof phoneOnlySchema>,
  ) {
    return this.accessManagement.acceptInvitation(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(invitationId),
      body.phoneE164,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Post('staff/invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeInvitation(
    @Param('invitationId') invitationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
  ) {
    return this.accessManagement.revokeInvitation(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(invitationId),
      body.reason,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Patch('staff/:membershipId')
  updateMembershipRole(
    @Param('membershipId') membershipId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(membershipRoleSchema)) body: z.infer<typeof membershipRoleSchema>,
  ) {
    return this.accessManagement.updateMembershipRole(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(membershipId),
      body.roleId,
      body.reason,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Post('staff/:membershipId/suspend')
  @HttpCode(HttpStatus.OK)
  suspendMembership(
    @Param('membershipId') membershipId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
  ) {
    return this.accessManagement.changeMembershipStatus(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(membershipId),
      'suspended',
      body.reason,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Post('staff/:membershipId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivateMembership(
    @Param('membershipId') membershipId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
  ) {
    return this.accessManagement.changeMembershipStatus(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(membershipId),
      'active',
      body.reason,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Post('staff/:membershipId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeMembership(
    @Param('membershipId') membershipId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.accessManagement.changeMembershipStatus(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(membershipId),
      'revoked',
      body.reason,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Get('memberships/:membershipId/permission-overrides')
  overrides(
    @Param('membershipId') membershipId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.accessManagement.listOverrides(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(membershipId),
      this.correlation(this.header(headers, 'x-correlation-id')),
    );
  }

  @Put('memberships/:membershipId/permission-overrides')
  @HttpCode(HttpStatus.CREATED)
  createOverride(
    @Param('membershipId') membershipId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(overrideCreateSchema)) body: z.infer<typeof overrideCreateSchema>,
  ) {
    return this.accessManagement.createOverride(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(membershipId),
      body,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Delete('memberships/:membershipId/permission-overrides/:overrideId')
  @HttpCode(HttpStatus.OK)
  revokeOverride(
    @Param('membershipId') membershipId: string,
    @Param('overrideId') overrideId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.accessManagement.revokeOverride(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.pathUuid(membershipId),
      this.pathUuid(overrideId),
      body.reason,
      this.commandMetaFromHeaders(headers),
    );
  }

  @Get('audit')
  audit(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQueryDto,
  ) {
    return this.accessManagement.listAudit(
      this.actor(this.header(headers, 'x-funtino-actor-user-id')),
      this.queryScope(query),
      { cursor: query.cursor, pageSize: query.pageSize },
      this.correlation(this.header(headers, 'x-correlation-id')),
      this.stepUpFromHeaders(headers),
    );
  }

  private header(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const value = headers[name.toLowerCase()];
    return typeof value === 'string' ? value : undefined;
  }

  private actor(raw: string | undefined): string {
    const value = uuid.safeParse(raw);
    if (!value.success) throw new UnauthorizedException('Actor context is missing.');
    return value.data;
  }

  private pathUuid(raw: string): string {
    return uuid.parse(raw);
  }

  private correlation(raw: string | undefined): string {
    const value = uuid.safeParse(raw);
    if (!value.success) throw new BadRequestException('A valid correlation ID is required.');
    return value.data;
  }

  private queryScope(
    query: Pick<RolesQueryDto, 'scopeType' | 'organizationId' | 'branchId'>,
  ): AccessScopeDto {
    const type =
      query.scopeType ??
      (query.branchId ? 'branch' : query.organizationId ? 'organization' : 'global');
    if (type === 'global') return { type: 'global' };
    if (!query.organizationId)
      throw new BadRequestException('Organization identifier is required.');
    if (type === 'organization')
      return { type: 'organization', organizationId: query.organizationId };
    if (!query.branchId) throw new BadRequestException('Branch identifier is required.');
    return { type: 'branch', organizationId: query.organizationId, branchId: query.branchId };
  }

  private commandMetaFromHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): AccessCommandMeta {
    const correlationId = this.correlation(this.header(headers, 'x-correlation-id'));
    const idempotencyKey = this.header(headers, 'idempotency-key');
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException('A valid Idempotency-Key is required.');
    }
    const rawIfMatch = this.header(headers, 'if-match');
    let expectedVersion: number | undefined;
    if (rawIfMatch !== undefined) {
      const match = /^"([1-9][0-9]*)"$/.exec(rawIfMatch);
      if (!match) throw new BadRequestException('If-Match must contain a quoted positive version.');
      expectedVersion = Number(match[1]);
      if (!Number.isSafeInteger(expectedVersion))
        throw new BadRequestException('If-Match version is invalid.');
    }
    const stepUp = this.stepUpFromHeaders(headers);
    return {
      correlationId,
      idempotencyKey,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...(stepUp ? { stepUp } : {}),
    };
  }

  private stepUpFromHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): AccessCommandMeta['stepUp'] {
    const rawVerifiedAt = this.header(headers, 'x-funtino-mfa-verified-at');
    const rawFactorVersion = this.header(headers, 'x-funtino-mfa-factor-version');
    const rawMethod = this.header(headers, 'x-funtino-mfa-method');
    const hasMfa =
      rawVerifiedAt !== undefined || rawFactorVersion !== undefined || rawMethod !== undefined;
    if (!hasMfa) return undefined;
    const sessionId = uuid.safeParse(this.header(headers, 'x-funtino-session-id'));
    const verifiedAt = z.string().datetime({ offset: true }).safeParse(rawVerifiedAt);
    const version = z.coerce.number().int().positive().safeParse(rawFactorVersion);
    if (
      !sessionId.success ||
      !verifiedAt.success ||
      !version.success ||
      (rawMethod !== 'totp' && rawMethod !== 'recovery')
    ) {
      throw new UnauthorizedException('Trusted MFA session evidence is invalid.');
    }
    return {
      sessionId: sessionId.data,
      verifiedAt: verifiedAt.data,
      factorVersion: version.data,
      method: rawMethod,
    };
  }

  private mfaContext(
    rawActor: string | undefined,
    rawSession: string | undefined,
    rawCorrelation: string | undefined,
  ): MfaContext {
    const actorUserId = uuid.safeParse(rawActor);
    const sessionId = uuid.safeParse(rawSession);
    const correlationId = uuid.safeParse(rawCorrelation);
    if (!actorUserId.success || !sessionId.success || !correlationId.success) {
      throw new UnauthorizedException('A verified user and session context is required.');
    }
    return {
      actorUserId: actorUserId.data,
      sessionId: sessionId.data,
      correlationId: correlationId.data,
    };
  }
}
