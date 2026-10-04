import { Injectable } from '@nestjs/common';
import {
  createSafeErrorDiagnostic,
  DomainError,
  writeStructuredLog,
} from '@funtino/backend-core';
import { z, type ZodType } from 'zod';
import type { Session } from '../../domain/models.js';

const uuidSchema = z.string().uuid();
const accessScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }),
  z.object({ type: z.literal('organization'), organizationId: uuidSchema }),
  z.object({ type: z.literal('branch'), organizationId: uuidSchema, branchId: uuidSchema }),
]);
const roleSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  scope: accessScopeSchema,
  permissionKeys: z.array(z.string()),
  systemManaged: z.boolean(),
  status: z.enum(['active', 'disabled']),
  version: z.number().int().positive(),
});
const membershipSchema = z.object({
  id: uuidSchema,
  status: z.enum(['pending', 'active', 'suspended', 'revoked']),
  scope: accessScopeSchema,
  role: roleSummarySchema,
  version: z.number().int().positive(),
});
const accessContextSchema = z.object({
  data: z.array(membershipSchema),
  policyVersion: z.number().int().positive(),
  catalogVersion: z.number().int().positive(),
});
const permissionCatalogSchema = z.object({
  catalogVersion: z.number().int().positive(),
  data: z.array(
    z.object({
      key: z.string(),
      scopes: z.array(z.enum(['global', 'organization', 'branch'])),
      delegable: z.boolean(),
      stepUp: z.boolean(),
    }),
  ),
});
const roleListSchema = z.object({
  status: z.literal('success'),
  data: z.array(roleSummarySchema),
  nextCursor: uuidSchema.nullable(),
});
const policyVersionSchema = z.number().int().positive();
const mutationResultSchema = <T extends ZodType>(item: T) =>
  z.object({ data: item, policyVersion: policyVersionSchema });
const roleMutationSchema = mutationResultSchema(roleSummarySchema);
const staffMembershipSchema = z.object({
  membershipId: uuidSchema,
  userId: uuidSchema,
  status: z.enum(['pending', 'active', 'suspended', 'revoked']),
  scope: accessScopeSchema,
  role: roleSummarySchema,
  version: z.number().int().positive(),
  maskedPhone: z.string().nullable().optional(),
});
const staffListSchema = z.object({
  data: z.array(staffMembershipSchema),
  nextCursor: uuidSchema.nullable(),
  policyVersion: policyVersionSchema,
});
const invitationSchema = z.object({
  id: uuidSchema,
  membershipId: uuidSchema,
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  maskedPhone: z.string(),
  scope: accessScopeSchema,
  role: roleSummarySchema,
  expiresAt: z.string().datetime({ offset: true }),
});
const invitationResultSchema = mutationResultSchema(invitationSchema);
const scopedInvitationListSchema = z.object({
  data: z.array(
    z.object({
      id: uuidSchema,
      membershipId: uuidSchema,
      status: z.literal('pending'),
      scope: accessScopeSchema,
      role: roleSummarySchema,
      maskedPhone: z.string(),
      expiresAt: z.string().datetime({ offset: true }),
      isExpired: z.boolean(),
      roleChanged: z.boolean(),
    }),
  ),
  nextCursor: uuidSchema.nullable(),
  policyVersion: policyVersionSchema,
});
const pendingInvitationsSchema = z.object({
  data: z.array(
    z.object({
      id: uuidSchema,
      scope: accessScopeSchema,
      role: roleSummarySchema,
      maskedPhone: z.string(),
      expiresAt: z.string().datetime({ offset: true }),
      roleChanged: z.boolean(),
    }),
  ),
});
const membershipResultSchema = mutationResultSchema(
  z.object({
    membershipId: uuidSchema,
    userId: uuidSchema,
    status: z.enum(['pending', 'active', 'suspended', 'revoked']),
    scope: accessScopeSchema,
    role: roleSummarySchema,
    version: z.number().int().positive(),
  }),
);
const overrideSchema = z.object({
  kind: z.literal('permission_override'),
  id: uuidSchema,
  membershipId: uuidSchema,
  permissionKey: z.string(),
  effect: z.enum(['allow', 'deny']),
  scope: accessScopeSchema,
  resource: z.object({ type: z.string(), id: z.string() }).optional(),
  startsAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  reason: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
});
const overrideResultSchema = mutationResultSchema(overrideSchema);
const overrideListSchema = z.object({
  data: z.array(overrideSchema),
  policyVersion: policyVersionSchema,
});
const auditListSchema = z.object({
  data: z.array(
    z.object({
      id: uuidSchema,
      actorType: z.enum(['user', 'system']),
      actorUserId: uuidSchema.nullable(),
      actorLabel: z.string().nullable(),
      action: z.string(),
      targetType: z.string(),
      targetId: z.string(),
      scope: accessScopeSchema,
      reason: z.string(),
      beforeState: z.unknown().nullable(),
      afterState: z.unknown().nullable(),
      policyVersion: z.number().int().nullable(),
      correlationId: uuidSchema,
      outcome: z.enum(['succeeded', 'denied', 'failed']),
      createdAt: z.string().datetime({ offset: true }),
    }),
  ),
  nextCursor: z.string().nullable(),
  policyVersion: policyVersionSchema,
});

export type AccessScopeDto = z.infer<typeof accessScopeSchema>;
const mfaStatusSchema = z.object({
  enabled: z.boolean(),
  enrollmentPending: z.boolean(),
  recoveryCodesRemaining: z.number().int().min(0).max(10),
});
const enrollmentSchema = z.object({
  secret: z.string().min(16).max(64),
  otpauthUri: z.string().startsWith('otpauth://totp/'),
  expiresAt: z.string().datetime({ offset: true }),
});
const recoveryCodesSchema = z.object({
  recoveryCodes: z.array(z.string().regex(/^[0-9A-F]{8}(?:-[0-9A-F]{8}){3}$/)).length(10),
  factorVersion: z.number().int().positive(),
  method: z.enum(['totp', 'recovery']),
  verifiedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
});
const stepUpSchema = z.object({
  method: z.enum(['totp', 'recovery']),
  factorVersion: z.number().int().positive(),
  verifiedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
});
const authorizationResultSchema = z.object({
  allowed: z.boolean(),
  reason: z
    .enum([
      'role_permission',
      'user_allow_override',
      'user_deny_override',
      'permission_unknown',
      'policy_version_invalid',
      'evaluation_time_invalid',
      'membership_inactive',
      'actor_mismatch',
      'role_inactive',
      'scope_invalid',
      'permission_not_granted',
      'step_up_required',
      'step_up_policy_unconfigured',
    ])
    .optional(),
  policyVersion: z.number().int().positive(),
  catalogVersion: z.number().int().positive(),
});

type RoleSummaryDto = z.infer<typeof roleSummarySchema>;

export type OperationsAccessContext = {
  memberships: Array<{
    membershipId: string;
    status: 'pending' | 'active' | 'suspended' | 'revoked';
    scope: AccessScopeDto;
    role: RoleSummaryDto;
    version: number;
  }>;
  policyVersion: number;
  catalogVersion: number;
};

export type MfaProof = { method: 'totp' | 'recovery'; code: string };
export type OperationsAuthorizationRequest = {
  permission: string;
  scope: AccessScopeDto;
  resource?: { type: string; id: string };
};

type IdentityAccessRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  sessionId?: string;
  session?: Session;
  idempotencyKey?: string;
  expectedVersion?: number;
};

@Injectable()
export class IdentityAccessClient {
  async currentAccessContext(
    userId: string,
    correlationId: string,
  ): Promise<OperationsAccessContext> {
    const response = await this.request(
      '/internal/v1/staff/memberships/current',
      userId,
      correlationId,
    );
    const parsed = this.parse(accessContextSchema, response);
    return {
      memberships: parsed.data.map(({ id, ...membership }) => ({
        ...membership,
        membershipId: id,
      })),
      policyVersion: parsed.policyVersion,
      catalogVersion: parsed.catalogVersion,
    };
  }

  async permissionCatalog(correlationId: string) {
    return this.parse(
      permissionCatalogSchema,
      await this.request('/internal/v1/permissions', undefined, correlationId),
    );
  }

  async listRoles(
    userId: string,
    organizationId: string,
    branchId: string | undefined,
    correlationId: string,
    pagination: { cursor?: string; pageSize?: number } = {},
  ) {
    return this.listRolesInScope(
      userId,
      branchId
        ? { type: 'branch', organizationId, branchId }
        : { type: 'organization', organizationId },
      correlationId,
      pagination,
    );
  }

  async listRolesInScope(
    userId: string,
    scope: AccessScopeDto,
    correlationId: string,
    pagination: { cursor?: string; pageSize?: number } = {},
  ) {
    const query = this.scopeQuery(scope);
    if (pagination.cursor) query.set('cursor', pagination.cursor);
    if (pagination.pageSize !== undefined) query.set('pageSize', String(pagination.pageSize));
    const result = this.parse(
      roleListSchema,
      await this.request(`/internal/v1/roles?${query.toString()}`, userId, correlationId),
    );
    return { data: result.data, nextCursor: result.nextCursor };
  }

  async roleTemplates(userId: string, scope: AccessScopeDto, correlationId: string) {
    return this.parse(
      z.object({
        catalogVersion: z.number().int().positive(),
        policyVersion: z.number().int().positive(),
        data: z.array(
          z.object({
            key: z.string(),
            name: z.string(),
            scopeType: z.enum(['global', 'organization', 'branch']),
            permissionKeys: z.array(z.string()),
          }),
        ),
      }),
      await this.request(
        `/internal/v1/roles/templates?${this.scopeQuery(scope).toString()}`,
        userId,
        correlationId,
      ),
    );
  }

  async createRole(
    userId: string,
    session: Session,
    correlationId: string,
    idempotencyKey: string,
    body: unknown,
  ) {
    return this.parse(
      roleMutationSchema,
      await this.request('/internal/v1/roles', userId, correlationId, {
        method: 'POST',
        body,
        idempotencyKey,
        session,
      }),
    );
  }

  async updateRole(
    userId: string,
    session: Session,
    roleId: string,
    expectedVersion: number,
    correlationId: string,
    idempotencyKey: string,
    body: unknown,
  ) {
    return this.parse(
      roleMutationSchema,
      await this.request(
        `/internal/v1/roles/${encodeURIComponent(roleId)}`,
        userId,
        correlationId,
        {
          method: 'PATCH',
          body,
          idempotencyKey,
          expectedVersion,
          session,
        },
      ),
    );
  }

  async listStaff(
    userId: string,
    scope: AccessScopeDto,
    correlationId: string,
    pagination: { cursor?: string; pageSize?: number } = {},
  ) {
    const query = this.scopeQuery(scope);
    if (pagination.cursor) query.set('cursor', pagination.cursor);
    if (pagination.pageSize !== undefined) query.set('pageSize', String(pagination.pageSize));
    return this.parse(
      staffListSchema,
      await this.request(`/internal/v1/staff?${query.toString()}`, userId, correlationId),
    );
  }

  async inviteStaff(
    userId: string,
    session: Session,
    correlationId: string,
    idempotencyKey: string,
    body: unknown,
  ) {
    return this.parse(
      invitationResultSchema,
      await this.request('/internal/v1/staff/invitations', userId, correlationId, {
        method: 'POST',
        body,
        idempotencyKey,
        session,
      }),
    );
  }

  async listScopedInvitations(
    userId: string,
    scope: AccessScopeDto,
    correlationId: string,
    pagination: { cursor?: string; pageSize?: number } = {},
  ) {
    const query = this.scopeQuery(scope);
    if (pagination.cursor) query.set('cursor', pagination.cursor);
    if (pagination.pageSize !== undefined) query.set('pageSize', String(pagination.pageSize));
    return this.parse(
      scopedInvitationListSchema,
      await this.request(
        `/internal/v1/staff/invitations?${query.toString()}`,
        userId,
        correlationId,
      ),
    );
  }

  async pendingInvitations(
    userId: string,
    session: Session,
    verifiedPhone: string,
    correlationId: string,
  ) {
    return this.parse(
      pendingInvitationsSchema,
      await this.request('/internal/v1/staff/invitations/pending', userId, correlationId, {
        method: 'POST',
        body: { phoneE164: verifiedPhone },
        session,
      }),
    );
  }

  async acceptInvitation(
    userId: string,
    session: Session,
    invitationId: string,
    verifiedPhone: string,
    correlationId: string,
    idempotencyKey: string,
  ) {
    return this.parse(
      mutationResultSchema(
        z.object({
          membershipId: uuidSchema,
          status: z.literal('active'),
          scope: accessScopeSchema,
          role: roleSummarySchema,
        }),
      ),
      await this.request(
        `/internal/v1/staff/invitations/${encodeURIComponent(invitationId)}/accept`,
        userId,
        correlationId,
        {
          method: 'POST',
          body: { phoneE164: verifiedPhone },
          idempotencyKey,
          session,
        },
      ),
    );
  }

  async revokeInvitation(
    userId: string,
    session: Session,
    invitationId: string,
    reason: string,
    correlationId: string,
    idempotencyKey: string,
  ) {
    return this.parse(
      mutationResultSchema(
        z.object({ id: uuidSchema, membershipId: uuidSchema, status: z.literal('revoked') }),
      ),
      await this.request(
        `/internal/v1/staff/invitations/${encodeURIComponent(invitationId)}/revoke`,
        userId,
        correlationId,
        {
          method: 'POST',
          body: { reason },
          idempotencyKey,
          session,
        },
      ),
    );
  }

  async updateMembershipRole(
    userId: string,
    session: Session,
    membershipId: string,
    expectedVersion: number,
    roleId: string,
    reason: string,
    correlationId: string,
    idempotencyKey: string,
  ) {
    return this.parse(
      membershipResultSchema,
      await this.request(
        `/internal/v1/staff/${encodeURIComponent(membershipId)}`,
        userId,
        correlationId,
        {
          method: 'PATCH',
          body: { roleId, reason },
          idempotencyKey,
          expectedVersion,
          session,
        },
      ),
    );
  }

  async changeMembershipStatus(
    userId: string,
    session: Session,
    membershipId: string,
    action: 'suspend' | 'reactivate' | 'revoke',
    reason: string,
    correlationId: string,
    idempotencyKey: string,
  ) {
    return this.parse(
      membershipResultSchema,
      await this.request(
        `/internal/v1/staff/${encodeURIComponent(membershipId)}/${action}`,
        userId,
        correlationId,
        {
          method: 'POST',
          body: { reason },
          idempotencyKey,
          session,
        },
      ),
    );
  }

  async listOverrides(userId: string, membershipId: string, correlationId: string) {
    return this.parse(
      overrideListSchema,
      await this.request(
        `/internal/v1/memberships/${encodeURIComponent(membershipId)}/permission-overrides`,
        userId,
        correlationId,
      ),
    );
  }

  async createOverride(
    userId: string,
    session: Session,
    membershipId: string,
    correlationId: string,
    idempotencyKey: string,
    body: unknown,
  ) {
    return this.parse(
      overrideResultSchema,
      await this.request(
        `/internal/v1/memberships/${encodeURIComponent(membershipId)}/permission-overrides`,
        userId,
        correlationId,
        {
          method: 'PUT',
          body,
          idempotencyKey,
          session,
        },
      ),
    );
  }

  async revokeOverride(
    userId: string,
    session: Session,
    membershipId: string,
    overrideId: string,
    reason: string,
    correlationId: string,
    idempotencyKey: string,
  ) {
    return this.parse(
      mutationResultSchema(overrideSchema),
      await this.request(
        `/internal/v1/memberships/${encodeURIComponent(membershipId)}/permission-overrides/${encodeURIComponent(overrideId)}`,
        userId,
        correlationId,
        {
          method: 'DELETE',
          body: { reason },
          idempotencyKey,
          session,
        },
      ),
    );
  }

  async listAudit(
    userId: string,
    session: Session,
    scope: AccessScopeDto,
    correlationId: string,
    pagination: { cursor?: string; pageSize?: number } = {},
  ) {
    const query = this.scopeQuery(scope);
    if (pagination.cursor) query.set('cursor', pagination.cursor);
    if (pagination.pageSize !== undefined) query.set('pageSize', String(pagination.pageSize));
    return this.parse(
      auditListSchema,
      await this.request(`/internal/v1/audit?${query.toString()}`, userId, correlationId, {
        session,
      }),
    );
  }

  async mfaStatus(userId: string, sessionId: string, correlationId: string) {
    return this.parse(
      mfaStatusSchema,
      await this.request('/internal/v1/mfa/status', userId, correlationId, { sessionId }),
    );
  }

  async startMfaEnrollment(userId: string, sessionId: string, correlationId: string) {
    return this.parse(
      enrollmentSchema,
      await this.request('/internal/v1/mfa/enrollment/start', userId, correlationId, {
        method: 'POST',
        sessionId,
      }),
    );
  }

  async confirmMfaEnrollment(
    userId: string,
    sessionId: string,
    correlationId: string,
    code: string,
  ) {
    return this.parse(
      recoveryCodesSchema,
      await this.request('/internal/v1/mfa/enrollment/confirm', userId, correlationId, {
        method: 'POST',
        sessionId,
        body: { code },
      }),
    );
  }

  async verifyMfaStepUp(userId: string, sessionId: string, correlationId: string, proof: MfaProof) {
    return this.parse(
      stepUpSchema,
      await this.request('/internal/v1/mfa/step-up/verify', userId, correlationId, {
        method: 'POST',
        sessionId,
        body: proof,
      }),
    );
  }

  async regenerateMfaRecoveryCodes(
    userId: string,
    sessionId: string,
    correlationId: string,
    proof: MfaProof,
  ) {
    return this.parse(
      recoveryCodesSchema,
      await this.request('/internal/v1/mfa/recovery-codes/regenerate', userId, correlationId, {
        method: 'POST',
        sessionId,
        body: proof,
      }),
    );
  }

  async disableMfa(userId: string, sessionId: string, correlationId: string, proof: MfaProof) {
    return this.parse(
      z.object({ enabled: z.literal(false) }),
      await this.request('/internal/v1/mfa/disable', userId, correlationId, {
        method: 'POST',
        sessionId,
        body: proof,
      }),
    );
  }

  async evaluateAuthorization(
    userId: string,
    session: Session,
    request: OperationsAuthorizationRequest,
    correlationId: string,
  ) {
    const mfa =
      session.mfaVerifiedAt !== null &&
      session.mfaFactorVersion !== null &&
      session.mfaMethod !== null
        ? {
            verifiedAt: new Date(session.mfaVerifiedAt).toISOString(),
            factorVersion: session.mfaFactorVersion,
            method: session.mfaMethod,
          }
        : undefined;
    return this.parse(
      authorizationResultSchema,
      await this.request('/internal/v1/authorization/evaluate', userId, correlationId, {
        method: 'POST',
        sessionId: session.id,
        body: { ...request, ...(mfa ? { mfa } : {}) },
      }),
    );
  }

  protected fetcher(input: URL, init: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  private parse<T>(schema: ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      writeStructuredLog({
        level: 'error',
        event: 'dependency.contract.invalid',
        service: 'api-gateway',
        component: 'IdentityAccessClient.parse',
        stage: 'response_contract_validation',
        dependency: 'identity-access',
        error: createSafeErrorDiagnostic(result.error),
      });
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'قرارداد سرویس مدیریت دسترسی ناسازگار است.');
    }
    return result.data;
  }

  private scopeQuery(scope: AccessScopeDto): URLSearchParams {
    const query = new URLSearchParams({ scopeType: scope.type });
    if (scope.type !== 'global') query.set('organizationId', scope.organizationId);
    if (scope.type === 'branch') query.set('branchId', scope.branchId);
    return query;
  }

  private async request(
    path: string,
    actorUserId?: string,
    correlationId?: string,
    options: IdentityAccessRequestOptions = {},
  ): Promise<unknown> {
    const baseUrl = process.env.IDENTITY_ACCESS_URL;
    const serviceToken = process.env.IDENTITY_ACCESS_SERVICE_TOKEN;
    if (!baseUrl || !serviceToken || serviceToken.length < 32) {
      throw new DomainError(
        'DEPENDENCY_UNAVAILABLE',
        'سرویس مدیریت دسترسی هنوز پیکربندی نشده است.',
      );
    }

    let url: URL;
    try {
      url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Invalid internal service URL.');
      }
      if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
        throw new Error('Internal service traffic must use TLS in production.');
      }
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'dependency.configuration.invalid',
        service: 'api-gateway',
        component: 'IdentityAccessClient.request',
        stage: 'build_internal_url',
        dependency: 'identity-access',
        error: createSafeErrorDiagnostic(error),
      });
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'نشانی سرویس مدیریت دسترسی معتبر نیست.');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-funtino-service-token': serviceToken,
      'cache-control': 'no-store',
    };
    if (actorUserId) headers['x-funtino-actor-user-id'] = actorUserId;
    if (correlationId) headers['x-correlation-id'] = correlationId;
    if (options.sessionId) headers['x-funtino-session-id'] = options.sessionId;
    if (options.session) {
      headers['x-funtino-session-id'] = options.session.id;
      if (
        options.session.mfaVerifiedAt !== null &&
        options.session.mfaFactorVersion !== null &&
        options.session.mfaMethod !== null
      ) {
        headers['x-funtino-mfa-verified-at'] = new Date(
          options.session.mfaVerifiedAt,
        ).toISOString();
        headers['x-funtino-mfa-factor-version'] = String(options.session.mfaFactorVersion);
        headers['x-funtino-mfa-method'] = options.session.mfaMethod;
      }
    }
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.expectedVersion !== undefined) headers['if-match'] = `"${options.expectedVersion}"`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس مدیریت دسترسی در دسترس نیست.');
    }

    if (!response.ok) {
      if (response.status === 400) {
        throw new DomainError('VALIDATION_ERROR', 'درخواست یا کد تأیید معتبر نیست.');
      }
      if (response.status === 401) {
        throw new DomainError('UNAUTHENTICATED', 'کد تأیید نامعتبر است یا دیگر قابل استفاده نیست.');
      }
      if (response.status === 403) {
        throw new DomainError('FORBIDDEN', 'دسترسی به این محدوده مجاز نیست.');
      }
      if (response.status === 404) {
        throw new DomainError('NOT_FOUND', 'مورد درخواستی پیدا نشد.');
      }
      if (response.status === 409) {
        throw new DomainError('CONFLICT', 'وضعیت داده تغییر کرده یا نسخه‌ی درخواست قدیمی است.');
      }
      if (response.status === 429) {
        throw new DomainError('RATE_LIMITED', 'تلاش‌های تأیید موقتاً قفل شده‌اند.');
      }
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'پاسخ سرویس مدیریت دسترسی معتبر نیست.');
    }

    try {
      return await response.json();
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'dependency.response.invalid',
        service: 'api-gateway',
        component: 'IdentityAccessClient.request',
        stage: 'response_json_parse',
        dependency: 'identity-access',
        error: createSafeErrorDiagnostic(error),
      });
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'پاسخ سرویس مدیریت دسترسی قابل خواندن نیست.');
    }
  }
}
