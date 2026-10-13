import { Injectable } from '@nestjs/common';
import { DomainError, isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';
import { z } from 'zod';

const uuid = z.string().uuid();
const memberSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    displayName: z.string().min(2).max(80),
    relationship: z.string().min(2).max(40),
    birthDate: z.string().date().nullable(),
    status: z.enum(['active', 'pending', 'archived']),
    isDependent: z.boolean(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const householdSchema = z
  .object({
    id: uuid,
    name: z.string().min(2).max(80),
    status: z.enum(['active', 'suspended', 'archived']),
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    members: z.array(memberSchema),
  })
  .strict();
const householdListSchema = z.object({ items: z.array(householdSchema).max(200) }).strict();
const createdHouseholdSchema = householdSchema.omit({ members: true }).strict();
const createdMemberSchema = memberSchema;
const relationshipSchema = z
  .object({
    id: uuid.optional(),
    fromMemberId: uuid,
    toMemberId: uuid,
    kind: z.enum(['parent_of', 'spouse_of', 'sibling_of', 'guardian_of']),
    basis: z.enum(['biological', 'legal', 'adoptive', 'step', 'partner', 'unspecified']),
  })
  .strict();
const invitationStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'revoked',
  'expired',
  'claim_pending',
  'linked',
  'conflict_review',
]);
const invitationSchema = z
  .object({
    id: uuid,
    householdId: uuid,
    memberId: uuid,
    kind: z.enum(['adult_account', 'dependent_claim']),
    status: invitationStatusSchema,
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const householdInvitationSchema = invitationSchema
  .extend({ memberName: z.string().min(2).max(80) })
  .strict();
const familyMemberSchema = memberSchema
  .extend({
    displayGender: z.enum(['female', 'male', 'unspecified']).nullable(),
    isAccountLinked: z.boolean(),
    isViewer: z.boolean(),
    relationshipLabel: z.string().min(1).max(80),
    relationshipStatus: z.enum(['verified', 'ambiguous', 'needs_review']),
  })
  .strict();
const familyHouseholdSchema = householdSchema
  .extend({
    accessRole: z.enum(['owner', 'guardian', 'member']),
    canManage: z.boolean(),
    viewerMemberId: uuid.nullable(),
    members: z.array(familyMemberSchema).max(500),
    relationships: z.array(relationshipSchema).max(2000),
    invitations: z.array(householdInvitationSchema).max(50),
  })
  .strict();
const familyResponseSchema = z
  .object({
    items: z.array(familyHouseholdSchema).max(200),
    invitations: z
      .array(
        invitationSchema
          .extend({
            householdName: z.string().min(2).max(80),
            memberName: z.string().min(2).max(80),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
const familyAuditHistorySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            action: z.string().min(1).max(120),
            createdAt: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();
const removedFamilyRelationshipSchema = z
  .object({
    relationshipId: uuid,
    householdId: uuid,
    memberId: uuid,
    version: z.number().int().positive(),
  })
  .strict();
const createdFamilyMemberSchema = z
  .object({
    member: memberSchema,
    relationship: relationshipSchema.nullable(),
    invitation: invitationSchema
      .extend({ shareToken: z.string().min(40).max(128).optional() })
      .strict()
      .nullable(),
  })
  .strict();
const invitationPreviewSchema = z
  .object({
    valid: z.literal(true),
    invitationId: uuid,
    householdName: z.string().min(2).max(80),
    memberName: z.string().min(2).max(80),
    kind: z.enum(['adult_account', 'dependent_claim']),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
const invalidInvitationPreviewSchema = z.object({ valid: z.literal(false) }).strict();

export type CustomerFamily = z.infer<typeof familyResponseSchema>;
export type CustomerFamilyInvitation = z.infer<typeof invitationSchema>;
export type CustomerFamilyMemberInput = {
  displayName: string;
  relativeMemberId?: string | 'viewer' | null;
  relationship: 'parent' | 'child' | 'spouse' | 'sibling' | 'guardian' | 'ward';
  basis: 'biological' | 'legal' | 'adoptive' | 'step' | 'partner' | 'unspecified';
  displayGender?: 'female' | 'male' | 'unspecified';
  birthDate?: string | null;
  isDependent: boolean;
  targetUserId?: string;
  targetPhoneHash?: string;
  createClaimLink?: boolean;
};
export type CustomerFamilyMemberUpdateInput = {
  expectedVersion: number;
  displayName?: string;
  displayGender?: 'female' | 'male' | 'unspecified' | null;
  birthDate?: string | null;
  relationshipId?: string;
  relativeMemberId?: string;
  relationship?: CustomerFamilyMemberInput['relationship'];
  basis?: CustomerFamilyMemberInput['basis'];
};

export type CustomerHousehold = z.infer<typeof householdSchema>;
export type CustomerHouseholdMemberInput = {
  displayName: string;
  relationship: string;
  birthDate?: string | null;
  isDependent?: boolean;
};

@Injectable()
export class CustomerHouseholdClient {
  protected fetcher(input: URL, init: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  async listHouseholdsForUser(userId: string): Promise<CustomerHousehold[]> {
    const parsed = householdListSchema.safeParse(
      await this.request(`/internal/v1/users/${encodeURIComponent(userId)}/households`),
    );
    if (!parsed.success) throw this.contractError();
    return parsed.data.items;
  }

  async listFamilyForUser(userId: string, targetPhoneHash?: string): Promise<CustomerFamily> {
    const parsed = familyResponseSchema.safeParse(
      await this.request(`/internal/v1/users/${encodeURIComponent(userId)}/family`, {
        method: 'POST',
        userId,
        body: { ...(targetPhoneHash ? { targetPhoneHash } : {}) },
      }),
    );
    if (!parsed.success) throw this.contractError();
    return parsed.data;
  }

  async listFamilyAuditHistory(actorUserId: string, householdId: string) {
    const parsed = familyAuditHistorySchema.safeParse(
      await this.request(
        `/internal/v1/households/${encodeURIComponent(householdId)}/family-audit`,
        {
          userId: actorUserId,
        },
      ),
    );
    if (!parsed.success) throw this.contractError();
    return parsed.data.items;
  }

  async addFamilyMember(
    userId: string,
    householdId: string,
    input: CustomerFamilyMemberInput,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = createdFamilyMemberSchema.safeParse(
      await this.request(
        `/internal/v1/households/${encodeURIComponent(householdId)}/family-members`,
        {
          method: 'POST',
          userId,
          correlationId: meta.correlationId,
          idempotencyKey: meta.idempotencyKey,
          body: input,
        },
      ),
    );
    if (
      !parsed.success ||
      parsed.data.member.householdId.toLowerCase() !== householdId.toLowerCase()
    ) {
      throw this.contractError();
    }
    return parsed.data;
  }

  async updateFamilyMember(
    userId: string,
    householdId: string,
    memberId: string,
    input: CustomerFamilyMemberUpdateInput,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = memberSchema.safeParse(
      await this.request(
        `/internal/v1/households/${encodeURIComponent(householdId)}/family-members/${encodeURIComponent(memberId)}`,
        {
          method: 'PATCH',
          userId,
          correlationId: meta.correlationId,
          idempotencyKey: meta.idempotencyKey,
          body: input,
        },
      ),
    );
    if (
      !parsed.success ||
      parsed.data.householdId.toLowerCase() !== householdId.toLowerCase() ||
      parsed.data.id.toLowerCase() !== memberId.toLowerCase()
    ) {
      throw this.contractError();
    }
    return parsed.data;
  }

  async archiveFamilyMember(
    userId: string,
    householdId: string,
    memberId: string,
    expectedVersion: number,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = memberSchema.safeParse(
      await this.request(
        `/internal/v1/households/${encodeURIComponent(householdId)}/family-members/${encodeURIComponent(memberId)}/archive`,
        {
          method: 'POST',
          userId,
          correlationId: meta.correlationId,
          idempotencyKey: meta.idempotencyKey,
          body: { expectedVersion },
        },
      ),
    );
    if (
      !parsed.success ||
      parsed.data.householdId.toLowerCase() !== householdId.toLowerCase() ||
      parsed.data.id.toLowerCase() !== memberId.toLowerCase() ||
      parsed.data.status !== 'archived'
    ) {
      throw this.contractError();
    }
    return parsed.data;
  }

  async removeFamilyRelationship(
    userId: string,
    householdId: string,
    relationshipId: string,
    input: { memberId: string; expectedVersion: number },
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = removedFamilyRelationshipSchema.safeParse(
      await this.request(
        `/internal/v1/households/${encodeURIComponent(householdId)}/family-relationships/${encodeURIComponent(relationshipId)}/remove`,
        {
          method: 'POST',
          userId,
          correlationId: meta.correlationId,
          idempotencyKey: meta.idempotencyKey,
          body: input,
        },
      ),
    );
    if (
      !parsed.success ||
      parsed.data.householdId.toLowerCase() !== householdId.toLowerCase() ||
      parsed.data.memberId.toLowerCase() !== input.memberId.toLowerCase() ||
      parsed.data.relationshipId.toLowerCase() !== relationshipId.toLowerCase()
    ) {
      throw this.contractError();
    }
    return parsed.data;
  }

  async previewFamilyInvitation(token: string) {
    const value = await this.request('/internal/v1/family-invitations/preview', {
      method: 'POST',
      body: { token },
    });
    const valid = invitationPreviewSchema.safeParse(value);
    if (valid.success) return valid.data;
    const invalid = invalidInvitationPreviewSchema.safeParse(value);
    if (invalid.success) return invalid.data;
    throw this.contractError();
  }

  async acceptFamilyInvitation(
    userId: string,
    input: { token?: string; invitationId?: string; verifiedPhoneHash?: string },
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = invitationSchema.safeParse(
      await this.request('/internal/v1/family-invitations/accept', {
        method: 'POST',
        userId,
        correlationId: meta.correlationId,
        idempotencyKey: meta.idempotencyKey,
        body: input,
      }),
    );
    if (!parsed.success) throw this.contractError();
    return parsed.data;
  }

  async linkFamilyInvitation(
    userId: string,
    invitationId: string,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    return this.commandInvitation(
      `/internal/v1/family-invitations/${encodeURIComponent(invitationId)}/link`,
      userId,
      meta,
    );
  }

  async approveDependentClaim(
    userId: string,
    invitationId: string,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    return this.commandInvitation(
      `/internal/v1/family-invitations/${encodeURIComponent(invitationId)}/approve-claim`,
      userId,
      meta,
    );
  }

  async declineFamilyInvitation(
    userId: string,
    invitationId: string,
    verifiedPhoneHash: string | undefined,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    return this.commandInvitation(
      `/internal/v1/family-invitations/${encodeURIComponent(invitationId)}/decline`,
      userId,
      meta,
      { ...(verifiedPhoneHash ? { verifiedPhoneHash } : {}) },
    );
  }

  async revokeFamilyInvitation(
    userId: string,
    invitationId: string,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    return this.commandInvitation(
      `/internal/v1/family-invitations/${encodeURIComponent(invitationId)}/revoke`,
      userId,
      meta,
    );
  }

  private async commandInvitation(
    path: string,
    userId: string,
    meta: { correlationId: string; idempotencyKey: string },
    body?: unknown,
  ) {
    const parsed = invitationSchema.safeParse(
      await this.request(path, {
        method: 'POST',
        userId,
        correlationId: meta.correlationId,
        idempotencyKey: meta.idempotencyKey,
        body: body ?? {},
      }),
    );
    if (!parsed.success) throw this.contractError();
    return parsed.data;
  }

  async createHousehold(
    userId: string,
    name: string,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = createdHouseholdSchema.safeParse(
      await this.request('/internal/v1/households', {
        method: 'POST',
        userId,
        correlationId: meta.correlationId,
        idempotencyKey: meta.idempotencyKey,
        body: { ownerUserId: userId, name },
      }),
    );
    if (!parsed.success) throw this.contractError();
    return parsed.data;
  }

  async addMember(
    userId: string,
    householdId: string,
    input: CustomerHouseholdMemberInput,
    meta: { correlationId: string; idempotencyKey: string },
  ) {
    const parsed = createdMemberSchema.safeParse(
      await this.request(`/internal/v1/households/${encodeURIComponent(householdId)}/members`, {
        method: 'POST',
        userId,
        correlationId: meta.correlationId,
        idempotencyKey: meta.idempotencyKey,
        body: input,
      }),
    );
    if (!parsed.success || parsed.data.householdId.toLowerCase() !== householdId.toLowerCase()) {
      throw this.contractError();
    }
    return parsed.data;
  }

  private async request(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH';
      userId?: string;
      correlationId?: string;
      idempotencyKey?: string;
      body?: unknown;
    } = {},
  ): Promise<unknown> {
    const baseUrl = process.env.CUSTOMER_HOUSEHOLD_URL;
    const token = process.env.CUSTOMER_HOUSEHOLD_GATEWAY_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512) {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس مدیریت خانواده پیکربندی نشده است.');
    }

    let endpoint: URL;
    try {
      const base = new URL(baseUrl);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        base.pathname !== '/' ||
        (process.env.NODE_ENV === 'production' &&
          base.protocol !== 'https:' &&
          !isRunflareClusterIpServiceBaseUrl(base))
      ) {
        throw new Error('Invalid Customer & Household URL');
      }
      endpoint = new URL(path, base);
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'نشانی سرویس مدیریت خانواده معتبر نیست.');
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-funtino-service-id': 'api-gateway',
      'x-funtino-service-token': token,
      'cache-control': 'no-store',
      pragma: 'no-cache',
    };
    if (options.userId) headers['x-funtino-actor-user-id'] = options.userId;
    if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: options.method ?? 'GET',
        headers,
        redirect: 'error',
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'سرویس مدیریت خانواده در دسترس نیست.');
    }
    if (!response.ok) {
      if (response.status === 404) throw new DomainError('NOT_FOUND', 'خانواده پیدا نشد.');
      if (response.status === 403)
        throw new DomainError('FORBIDDEN', 'دسترسی به این خانواده مجاز نیست.');
      if (response.status === 409)
        throw new DomainError('CONFLICT', 'تغییر خانواده با وضعیت فعلی سازگار نیست.');
      if (response.status === 400)
        throw new DomainError('VALIDATION_ERROR', 'اطلاعات خانواده معتبر نیست.');
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'پاسخ سرویس مدیریت خانواده معتبر نیست.');
    }
    try {
      return await response.json();
    } catch {
      throw this.contractError();
    }
  }

  private contractError(): DomainError {
    return new DomainError('DEPENDENCY_UNAVAILABLE', 'قرارداد سرویس مدیریت خانواده ناسازگار است.');
  }
}
