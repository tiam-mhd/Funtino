import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/index.js';
import {
  evaluateAuthorizationAcrossMemberships,
  evaluateDelegationAcrossMemberships,
  hasEffectivePermissionWithoutStepUp,
  type AccessScope,
  type AuthorizationContext,
} from '../domain/authorization/authorization-evaluator.js';
import { getPermissionDefinition } from '../domain/authorization/permission-catalog.js';
import { isEffectiveActiveMembership } from '../domain/authorization/bootstrap-membership.js';
import { MFA_STEP_UP_TTL_SECONDS } from '../domain/authorization/mfa-policy.js';
import { AccessManagementCryptoService } from './access-management-crypto.service.js';
import { AccessMutationJournalService } from './access-mutation-journal.service.js';
import { areManagementWritesEnabled } from './management-write-gate.js';
import {
  ORGANIZATION_SCOPE_OWNER,
  type OrganizationScopeOwner,
} from './ports/organization-scope-owner.port.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MFA_FRESHNESS_SECONDS = MFA_STEP_UP_TTL_SECONDS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TrustedStepUp = {
  sessionId: string;
  verifiedAt: string;
  factorVersion: number;
  method: 'totp' | 'recovery';
};

export type AccessCommandMeta = {
  correlationId: string;
  idempotencyKey: string;
  expectedVersion?: number;
  stepUp?: TrustedStepUp;
};

type ScopeRow = {
  scopeType: string;
  organizationId: string | null;
  branchId: string | null;
};

type MembershipWithAccess = Prisma.StaffMembershipGetPayload<{
  include: {
    role: { include: { permissions: true } };
    overrides: { where: { revokedAt: null } };
  };
}>;

type RoleWithPermissions = Prisma.AccessRoleGetPayload<{ include: { permissions: true } }>;

type AccessAuditSnapshot =
  | {
      kind: 'role';
      id: string;
      name: string;
      status: 'active' | 'disabled';
      scope: AccessScope;
      systemManaged: boolean;
      version: number;
      permissionKeys: string[];
    }
  | {
      kind: 'membership';
      id: string;
      status: 'pending' | 'active' | 'suspended' | 'revoked';
      scope: AccessScope;
      roleId: string;
      version: number;
    }
  | {
      kind: 'permission_override';
      id: string;
      membershipId: string;
      permissionKey: string;
      effect: 'allow' | 'deny';
      scope: AccessScope;
      resource?: { type: string; id: string };
      startsAt: string;
      expiresAt: string | null;
      revokedAt: string | null;
    };

type DeniedAuditContext = {
  actorUserId: string;
  action: string;
  targetType: 'role' | 'membership' | 'permission_override';
  targetId: string;
  scope: AccessScope;
  correlationId: string;
};
type DeniedAuditTarget = Omit<DeniedAuditContext, 'actorUserId'>;

class AccessDeniedError extends Error {
  constructor(readonly audit: DeniedAuditContext) {
    super('ACCESS_MANAGEMENT_DENIED');
    this.name = 'AccessDeniedError';
  }
}

function scopeFromColumns(row: ScopeRow): AccessScope {
  if (row.scopeType === 'global' && row.organizationId === null && row.branchId === null) {
    return { type: 'global' };
  }
  if (row.scopeType === 'organization' && row.organizationId && row.branchId === null) {
    return { type: 'organization', organizationId: row.organizationId };
  }
  if (row.scopeType === 'branch' && row.organizationId && row.branchId) {
    return { type: 'branch', organizationId: row.organizationId, branchId: row.branchId };
  }
  throw new ServiceUnavailableException('Stored access scope is invalid.');
}

function scopeColumns(scope: AccessScope) {
  return {
    scopeType: scope.type,
    organizationId: scope.type === 'global' ? null : scope.organizationId,
    branchId: scope.type === 'branch' ? scope.branchId : null,
  };
}

function roleSummary(role: RoleWithPermissions) {
  return {
    id: role.id,
    name: role.name,
    scope: scopeFromColumns(role),
    permissionKeys: role.permissions.map(({ permissionKey }) => permissionKey).sort(),
    systemManaged: role.systemManaged,
    status: role.status,
    version: role.version,
  };
}

function roleSnapshot(role: RoleWithPermissions): AccessAuditSnapshot {
  return { kind: 'role', ...roleSummary(role) };
}

function membershipSnapshot(input: {
  id: string;
  status: 'pending' | 'active' | 'suspended' | 'revoked';
  scope: AccessScope;
  roleId: string;
  version: number;
}): AccessAuditSnapshot {
  return { kind: 'membership', ...input };
}

function overrideSnapshot(row: {
  id: string;
  membershipId: string;
  permissionKey: string;
  effect: 'allow' | 'deny';
  scopeType: string;
  organizationId: string | null;
  branchId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): AccessAuditSnapshot {
  return {
    kind: 'permission_override',
    id: row.id,
    membershipId: row.membershipId,
    permissionKey: row.permissionKey,
    effect: row.effect,
    scope: scopeFromColumns(row),
    ...(row.resourceType && row.resourceId
      ? { resource: { type: row.resourceType, id: row.resourceId } }
      : {}),
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function isRoleAssignable(roleScope: AccessScope, membershipScope: AccessScope): boolean {
  if (roleScope.type === 'global') return membershipScope.type === 'global';
  if (membershipScope.type === 'global' || roleScope.organizationId !== membershipScope.organizationId) {
    return false;
  }
  if (roleScope.type === 'organization') return true;
  return membershipScope.type === 'branch' && roleScope.branchId === membershipScope.branchId;
}

function scopeContains(outer: AccessScope, inner: AccessScope): boolean {
  if (outer.type === 'global') return true;
  if (inner.type === 'global' || outer.organizationId !== inner.organizationId) return false;
  if (outer.type === 'organization') return true;
  return inner.type === 'branch' && outer.branchId === inner.branchId;
}

function snapshotMembership(row: MembershipWithAccess): AccessAuditSnapshot {
  return membershipSnapshot({
    id: row.id,
    status: row.status,
    scope: scopeFromColumns(row),
    roleId: row.roleId,
    version: row.version,
  });
}

function encodeAuditCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeAuditCursor(value: string | undefined): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const [rawDate, id, extra] = Buffer.from(value, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(rawDate ?? '');
    if (extra !== undefined || !UUID_PATTERN.test(id ?? '') || !Number.isFinite(createdAt.getTime())) {
      throw new Error('Malformed cursor.');
    }
    return { createdAt, id: id! };
  } catch {
    throw new BadRequestException('Audit cursor is invalid.');
  }
}

@Injectable()
export class AccessManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AccessMutationJournalService,
    private readonly crypto: AccessManagementCryptoService,
    @Inject(ORGANIZATION_SCOPE_OWNER)
    private readonly organizationScopeOwner: OrganizationScopeOwner,
  ) {}

  async createRole(
    actorUserId: string,
    input: { name: string; scope: AccessScope; permissionKeys: string[]; reason: string },
    meta: AccessCommandMeta,
  ) {
    const roleId = randomUUID();
    return this.runMutation(actorUserId, 'role.create', meta, input, async (tx, contexts, version, replay) => {
      const audit: DeniedAuditTarget = {
        action: 'access.role.create', targetType: 'role', targetId: roleId,
        scope: input.scope, correlationId: meta.correlationId,
      };
      this.requirePermissions(contexts, actorUserId, version, input.scope, ['access.role.manage'], audit);
      this.requireDelegation(contexts, actorUserId, version, input.permissionKeys, input.scope, audit);
      await this.assertTenantScopeWritable(input.scope, { actorUserId, ...audit });
      if (replay) return replay;

      const role = await tx.accessRole.create({
        data: {
          id: roleId,
          name: input.name.trim(),
          ...scopeColumns(input.scope),
          systemManaged: false,
          permissions: { create: input.permissionKeys.map((permissionKey) => ({ permissionKey })) },
        },
        include: { permissions: true },
      });
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType: 'role.created',
        targetType: 'role', targetId: role.id, scope: input.scope, reason: input.reason,
        afterState: roleSnapshot(role),
      });
      return { data: roleSummary(role), policyVersion: result.policyVersion };
    });
  }

  async updateRole(
    actorUserId: string,
    roleId: string,
    input: { name?: string; permissionKeys?: string[]; status?: 'active' | 'disabled'; reason: string },
    meta: AccessCommandMeta,
  ) {
    return this.runMutation(actorUserId, 'role.update', meta, { roleId, ...input }, async (tx, contexts, version, replay) => {
      const current = await tx.accessRole.findUnique({ where: { id: roleId }, include: { permissions: true } });
      if (!current) throw new NotFoundException('Role not found.');
      const scope = scopeFromColumns(current);
      const audit: DeniedAuditTarget = {
        action: 'access.role.update', targetType: 'role', targetId: roleId, scope,
        correlationId: meta.correlationId,
      };
      this.requirePermissions(contexts, actorUserId, version, scope, ['access.role.manage'], audit);
      if (current.systemManaged) throw new ConflictException('System-managed roles are immutable.');
      const nextPermissionKeys = input.permissionKeys ?? current.permissions.map(({ permissionKey }) => permissionKey);
      this.requireDelegation(contexts, actorUserId, version, nextPermissionKeys, scope, audit);
      await this.assertTenantScopeWritable(scope, { actorUserId, ...audit });
      if (replay) return replay;
      if (meta.expectedVersion === undefined || current.version !== meta.expectedVersion) {
        throw new ConflictException('Role version is stale.');
      }
      const changesAuthorization = input.permissionKeys !== undefined || (input.status !== undefined && input.status !== current.status);
      const affectedScopes = changesAuthorization ? await this.roleAffectedScopes(tx, current) : [];
      const administratorState = changesAuthorization
        ? await this.captureAdministratorState(tx, [...affectedScopes, scope], version)
        : new Map<string, { scope: AccessScope; hadAdministrator: boolean }>();

      const role = await tx.accessRole.update({
        where: { id: current.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          version: { increment: 1 },
          ...(input.permissionKeys !== undefined
            ? {
                permissions: {
                  deleteMany: {},
                  create: input.permissionKeys.map((permissionKey) => ({ permissionKey })),
                },
              }
            : {}),
        },
        include: { permissions: true },
      });
      if (changesAuthorization) {
        await this.assertNoAdministratorLoss(tx, administratorState, version + 1);
      }
      const changeType = input.status === 'disabled' ? 'role.disabled' : 'role.updated';
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType,
        targetType: 'role', targetId: role.id, scope, reason: input.reason,
        beforeState: roleSnapshot(current), afterState: roleSnapshot(role),
      });
      return { data: roleSummary(role), policyVersion: result.policyVersion };
    });
  }

  async inviteStaff(
    actorUserId: string,
    input: { phoneE164: string; scope: AccessScope; roleId: string; reason: string },
    meta: AccessCommandMeta,
  ) {
    const invitationId = randomUUID();
    const membershipId = randomUUID();
    const now = new Date();
    return this.runMutation(actorUserId, 'staff.invite', meta, input, async (tx, contexts, version, replay) => {
      const audit: DeniedAuditTarget = {
        action: 'staff.invite', targetType: 'membership', targetId: membershipId,
        scope: input.scope, correlationId: meta.correlationId,
      };
      this.requirePermissions(contexts, actorUserId, version, input.scope, ['staff.invite'], audit);
      const role = await tx.accessRole.findUnique({ where: { id: input.roleId }, include: { permissions: true } });
      if (!role || role.status !== 'active') throw new NotFoundException('Active role not found.');
      if (role.systemManaged) throw new ConflictException('System-managed roles can only be assigned by the offline bootstrap procedure.');
      const roleScope = scopeFromColumns(role);
      if (!isRoleAssignable(roleScope, input.scope)) throw new BadRequestException('Role and invitation scopes do not match.');
      this.requireDelegation(contexts, actorUserId, version, role.permissions.map(({ permissionKey }) => permissionKey), input.scope, audit);
      await this.assertTenantScopeWritable(input.scope, { actorUserId, ...audit });
      if (replay) return replay;

      const candidates = this.crypto.phoneHashCandidates(input.phoneE164);
      await this.expireMatchingInvitations(tx, candidates, input.scope, meta.correlationId);
      const hashes = candidates.map(({ keyVersion, hash }) => ({ phoneLookupHashKeyVersion: keyVersion, phoneLookupHash: hash }));
      const alreadyInvited = await tx.staffInvitation.findFirst({
        where: {
          status: 'pending', expiresAt: { gt: now },
          OR: hashes,
          ...scopeColumns(input.scope),
        },
      });
      if (alreadyInvited) throw new ConflictException('A pending invitation already exists for this scope.');
      const hash = this.crypto.hashPhone(input.phoneE164);
      const invitation = await tx.staffInvitation.create({
        data: {
          id: invitationId, membershipId, phoneLookupHash: hash.hash,
          phoneLookupHashKeyVersion: hash.keyVersion, maskedPhone: this.crypto.maskPhone(input.phoneE164),
          ...scopeColumns(input.scope), roleId: role.id, roleVersion: role.version,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), createdByUserId: actorUserId,
        },
      });
      const pendingState = membershipSnapshot({ id: membershipId, status: 'pending', scope: input.scope, roleId: role.id, version: 1 });
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType: 'membership.invited',
        targetType: 'membership', targetId: membershipId, scope: input.scope, reason: input.reason,
        afterState: pendingState,
      });
      return {
        data: {
          id: invitation.id, membershipId, status: invitation.status,
          maskedPhone: invitation.maskedPhone, scope: input.scope,
          role: roleSummary(role), expiresAt: invitation.expiresAt.toISOString(),
        },
        policyVersion: result.policyVersion,
      };
    });
  }

  async revokeInvitation(actorUserId: string, invitationId: string, reason: string, meta: AccessCommandMeta) {
    return this.runMutation(actorUserId, 'staff.invitation.revoke', meta, { invitationId, reason }, async (tx, contexts, version, replay) => {
      const invitation = await tx.staffInvitation.findUnique({ where: { id: invitationId }, include: { role: { include: { permissions: true } } } });
      if (!invitation) throw new NotFoundException('Invitation not found.');
      const scope = scopeFromColumns(invitation);
      const audit: DeniedAuditTarget = {
        action: 'staff.invitation.revoke', targetType: 'membership', targetId: invitation.membershipId,
        scope, correlationId: meta.correlationId,
      };
      this.requirePermissions(contexts, actorUserId, version, scope, ['staff.invite'], audit);
      await this.assertTenantScopeWritable(scope, { actorUserId, ...audit });
      if (replay) return replay;
      if (invitation.status !== 'pending') throw new ConflictException('Invitation is no longer pending.');
      const changed = await tx.staffInvitation.update({ where: { id: invitation.id }, data: { status: 'revoked', revokedAt: new Date() } });
      const beforeState = membershipSnapshot({ id: invitation.membershipId, status: 'pending', scope, roleId: invitation.roleId, version: 1 });
      const afterState = membershipSnapshot({ id: invitation.membershipId, status: 'revoked', scope, roleId: invitation.roleId, version: 2 });
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType: 'membership.revoked',
        targetType: 'membership', targetId: invitation.membershipId, scope, reason,
        beforeState, afterState,
      });
      return { data: { id: changed.id, membershipId: changed.membershipId, status: changed.status }, policyVersion: result.policyVersion };
    });
  }

  async listPendingInvitations(phoneE164: string) {
    const candidates = this.crypto.phoneHashCandidates(phoneE164);
    const rows = await this.prisma.staffInvitation.findMany({
      where: {
        status: 'pending', expiresAt: { gt: new Date() },
        OR: candidates.map(({ keyVersion, hash }) => ({ phoneLookupHashKeyVersion: keyVersion, phoneLookupHash: hash })),
      },
      include: { role: { include: { permissions: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50,
    });
    return {
      data: rows.map((row) => ({
        id: row.id, scope: scopeFromColumns(row), role: roleSummary(row.role),
        maskedPhone: row.maskedPhone, expiresAt: row.expiresAt.toISOString(),
        roleChanged: row.role.version !== row.roleVersion,
      })),
    };
  }

  async listScopedInvitations(
    actorUserId: string,
    scope: AccessScope,
    pagination: { cursor?: string; pageSize: number },
    correlationId: string,
  ) {
    this.validatePagination(pagination.pageSize);
    return this.withSnapshot(async (tx) => {
      const { contexts, policyVersion } = await this.loadActorContexts(tx, actorUserId);
      this.requirePermissions(contexts, actorUserId, policyVersion, scope, ['staff.read'], {
        action: 'staff.invitation.read', targetType: 'membership', targetId: actorUserId,
        scope, correlationId,
      });
      const scopeFilter: Prisma.StaffInvitationWhereInput = scope.type === 'global'
        ? { scopeType: 'global' }
        : scope.type === 'organization'
          ? { organizationId: scope.organizationId }
          : { organizationId: scope.organizationId, OR: [{ scopeType: 'organization' }, { scopeType: 'branch', branchId: scope.branchId }] };
      const cursor = pagination.cursor
        ? await tx.staffInvitation.findFirst({
            where: { id: pagination.cursor, AND: [scopeFilter] }, select: { createdAt: true, id: true },
          })
        : null;
      if (pagination.cursor && !cursor) throw new BadRequestException('Invitation cursor is invalid for this scope.');
      const rows = await tx.staffInvitation.findMany({
        where: {
          AND: [
            scopeFilter,
            { status: 'pending' },
            ...(cursor ? [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] : []),
          ],
        },
        include: { role: { include: { permissions: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pagination.pageSize + 1,
      });
      const hasMore = rows.length > pagination.pageSize;
      const page = rows.slice(0, pagination.pageSize);
      const now = Date.now();
      await this.journal.recordSensitiveAccess(tx, {
        actorUserId, action: 'staff.invitation.read', targetType: 'membership', targetId: actorUserId,
        scope, reason: 'Manager viewed pending invitations.', correlationId, policyVersion,
      });
      return {
        data: page.map((row) => ({
          id: row.id, membershipId: row.membershipId, status: row.status,
          scope: scopeFromColumns(row), role: roleSummary(row.role), maskedPhone: row.maskedPhone,
          expiresAt: row.expiresAt.toISOString(), isExpired: row.expiresAt.getTime() <= now,
          roleChanged: row.role.version !== row.roleVersion,
        })),
        nextCursor: hasMore ? page.at(-1)!.id : null,
        policyVersion,
      };
    });
  }

  async acceptInvitation(actorUserId: string, invitationId: string, verifiedPhoneE164: string, meta: AccessCommandMeta) {
    return this.runMutation(actorUserId, 'staff.invitation.accept', meta, { invitationId, verifiedPhoneE164 }, async (tx, _contexts, version, replay) => {
      const now = new Date();
      const candidates = this.crypto.phoneHashCandidates(verifiedPhoneE164);
      const invitation = await tx.staffInvitation.findFirst({
        where: {
          id: invitationId, status: { in: ['pending', 'accepted'] },
          OR: candidates.map(({ keyVersion, hash }) => ({ phoneLookupHashKeyVersion: keyVersion, phoneLookupHash: hash })),
        },
        include: { role: { include: { permissions: true } } },
      });
      if (!invitation) throw new NotFoundException('Invitation not found for the verified account.');
      const scope = scopeFromColumns(invitation);
      const audit: DeniedAuditContext = {
        actorUserId,
        action: 'staff.invitation.accept',
        targetType: 'membership',
        targetId: invitation.membershipId,
        scope,
        correlationId: meta.correlationId,
      };
      if (replay) {
        await this.assertTenantScopeWritable(scope, audit);
        return replay;
      }
      if (invitation.status !== 'pending') throw new ConflictException('Invitation has already been accepted or closed.');
      if (invitation.expiresAt.getTime() <= now.getTime()) throw new ConflictException('Invitation has expired.');
      if (invitation.role.systemManaged || invitation.role.status !== 'active' || invitation.role.version !== invitation.roleVersion) {
        throw new ConflictException('Invitation role changed; request a new invitation.');
      }
      await this.assertTenantScopeWritable(scope, audit);
      const duplicate = await tx.staffMembership.findFirst({
        where: {
          userId: actorUserId, status: { not: 'revoked' },
          ...scopeColumns(scope),
        },
      });
      if (duplicate) throw new ConflictException('An active membership already exists in this scope.');
      await tx.staffMembership.create({
        data: {
          id: invitation.membershipId, userId: actorUserId, ...scopeColumns(scope),
          roleId: invitation.roleId, status: 'active', version: 1,
        },
      });
      await tx.staffInvitation.update({ where: { id: invitation.id }, data: { status: 'accepted', acceptedAt: now } });
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType: 'membership.activated',
        targetType: 'membership', targetId: invitation.membershipId, scope,
        reason: 'The verified invitee explicitly accepted the staff invitation.',
        beforeState: membershipSnapshot({ id: invitation.membershipId, status: 'pending', scope, roleId: invitation.roleId, version: 1 }),
        afterState: membershipSnapshot({ id: invitation.membershipId, status: 'active', scope, roleId: invitation.roleId, version: 1 }),
      });
      return { data: { membershipId: invitation.membershipId, status: 'active', scope, role: roleSummary(invitation.role) }, policyVersion: result.policyVersion };
    });
  }

  async listStaff(
    actorUserId: string,
    scope: AccessScope,
    pagination: { cursor?: string; pageSize: number },
    meta: Pick<AccessCommandMeta, 'correlationId'>,
  ) {
    this.validatePagination(pagination.pageSize);
    return this.withSnapshot(async (tx) => {
      const { contexts, policyVersion } = await this.loadActorContexts(tx, actorUserId);
      this.requirePermissions(contexts, actorUserId, policyVersion, scope, ['staff.read'], {
        action: 'staff.read', targetType: 'membership', targetId: actorUserId,
        scope, correlationId: meta.correlationId,
      });
      const scopeFilter: Prisma.StaffMembershipWhereInput = scope.type === 'global'
        ? { scopeType: 'global' }
        : scope.type === 'organization'
          ? { organizationId: scope.organizationId }
          : { organizationId: scope.organizationId, OR: [{ scopeType: 'organization' }, { scopeType: 'branch', branchId: scope.branchId }] };
      const cursor = pagination.cursor
        ? await tx.staffMembership.findFirst({
            where: { id: pagination.cursor, AND: [scopeFilter] }, select: { createdAt: true, id: true },
          })
        : null;
      if (pagination.cursor && !cursor) throw new BadRequestException('Staff cursor is invalid for this scope.');
      const where: Prisma.StaffMembershipWhereInput = {
        AND: [
          scopeFilter,
          ...(cursor ? [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] : []),
        ],
      };
      const rows = await tx.staffMembership.findMany({
        where, include: { role: { include: { permissions: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: pagination.pageSize + 1,
      });
      const hasMore = rows.length > pagination.pageSize;
      const page = rows.slice(0, pagination.pageSize);
      const invitations = await tx.staffInvitation.findMany({
        where: { membershipId: { in: page.map(({ id }) => id) }, status: 'accepted' },
        select: { membershipId: true, maskedPhone: true },
      });
      const phones = new Map(invitations.map(({ membershipId, maskedPhone }) => [membershipId, maskedPhone]));
      await this.journal.recordSensitiveAccess(tx, {
        actorUserId, action: 'staff.read', targetType: 'membership', targetId: actorUserId,
        scope, reason: 'Manager viewed staff membership records.', correlationId: meta.correlationId, policyVersion,
      });
      return {
        data: page.map((row) => ({
          membershipId: row.id, userId: row.userId, status: row.status,
          scope: scopeFromColumns(row), role: roleSummary(row.role), version: row.version,
          maskedPhone: phones.get(row.id) ?? null,
        })),
        nextCursor: hasMore ? page.at(-1)!.id : null,
        policyVersion,
      };
    });
  }

  async updateMembershipRole(
    actorUserId: string,
    membershipId: string,
    roleId: string,
    reason: string,
    meta: AccessCommandMeta,
  ) {
    return this.runMutation(actorUserId, 'staff.membership.role.update', meta, { membershipId, roleId, reason }, async (tx, contexts, version, replay) => {
      const current = await tx.staffMembership.findUnique({
        where: { id: membershipId }, include: { role: { include: { permissions: true } }, overrides: { where: { revokedAt: null } } },
      });
      if (!current) throw new NotFoundException('Staff membership not found.');
      const scope = scopeFromColumns(current);
      const audit: DeniedAuditTarget = {
        action: 'staff.membership.role.update', targetType: 'membership', targetId: membershipId,
        scope, correlationId: meta.correlationId,
      };
      this.requirePermissions(contexts, actorUserId, version, scope, ['access.role.manage'], audit);
      await this.assertTenantScopeWritable(scope, { actorUserId, ...audit });
      if (replay) return replay;
      this.requireExpectedVersion(current.version, meta.expectedVersion, 'Membership');
      if (current.status === 'revoked') throw new ConflictException('Revoked memberships cannot be changed.');
      const nextRole = await tx.accessRole.findUnique({ where: { id: roleId }, include: { permissions: true } });
      if (!nextRole || nextRole.systemManaged || nextRole.status !== 'active' || !isRoleAssignable(scopeFromColumns(nextRole), scope)) {
        throw new BadRequestException('Selected role is not active or compatible with this membership scope.');
      }
      this.requireDelegation(contexts, actorUserId, version, nextRole.permissions.map(({ permissionKey }) => permissionKey), scope, {
        action: 'staff.membership.role.update', targetType: 'membership', targetId: membershipId,
        scope, correlationId: meta.correlationId,
      });
      const administratorState = await this.captureAdministratorState(tx, [scope], version);
      const updated = await tx.staffMembership.update({ where: { id: current.id }, data: { roleId: nextRole.id, version: { increment: 1 } }, include: { role: { include: { permissions: true } }, overrides: { where: { revokedAt: null } } } });
      await this.assertNoAdministratorLoss(tx, administratorState, version + 1);
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType: 'membership.role_changed',
        targetType: 'membership', targetId: current.id, scope, reason,
        beforeState: snapshotMembership(current), afterState: snapshotMembership(updated),
      });
      return { data: this.membershipSummary(updated), policyVersion: result.policyVersion };
    });
  }

  async changeMembershipStatus(
    actorUserId: string,
    membershipId: string,
    nextStatus: 'suspended' | 'active' | 'revoked',
    reason: string,
    meta: AccessCommandMeta,
  ) {
    const operation = nextStatus === 'suspended' ? 'staff.membership.suspend' : nextStatus === 'active' ? 'staff.membership.reactivate' : 'staff.membership.revoke';
    return this.runMutation(actorUserId, operation, meta, { membershipId, nextStatus, reason }, async (tx, contexts, version, replay) => {
      const current = await tx.staffMembership.findUnique({ where: { id: membershipId }, include: { role: { include: { permissions: true } }, overrides: { where: { revokedAt: null } } } });
      if (!current) throw new NotFoundException('Staff membership not found.');
      const scope = scopeFromColumns(current);
      const permission = nextStatus === 'suspended' ? 'staff.suspend' : nextStatus === 'active' ? 'staff.reactivate' : 'staff.suspend';
      const audit: DeniedAuditTarget = {
        action: operation, targetType: 'membership', targetId: membershipId,
        scope, correlationId: meta.correlationId,
      };
      this.requirePermissions(contexts, actorUserId, version, scope, [permission], audit);
      await this.assertTenantScopeWritable(scope, { actorUserId, ...audit });
      if (replay) return replay;
      if (current.status === 'revoked' || (nextStatus === 'active' && current.status !== 'suspended') || (nextStatus === 'suspended' && current.status !== 'active')) {
        throw new ConflictException('Membership lifecycle transition is not allowed.');
      }
      if (nextStatus === 'revoked' && current.status === 'pending') throw new ConflictException('Pending invitations must be revoked through the invitation lifecycle.');
      const affectedScopes = nextStatus === 'suspended' || nextStatus === 'revoked' ? [scope] : [];
      const administratorState = affectedScopes.length
        ? await this.captureAdministratorState(tx, affectedScopes, version)
        : new Map<string, { scope: AccessScope; hadAdministrator: boolean }>();
      const updated = await tx.staffMembership.update({ where: { id: current.id }, data: { status: nextStatus, version: { increment: 1 } }, include: { role: { include: { permissions: true } }, overrides: { where: { revokedAt: null } } } });
      if (affectedScopes.length) await this.assertNoAdministratorLoss(tx, administratorState, version + 1);
      const changeType = nextStatus === 'suspended' ? 'membership.suspended' : nextStatus === 'revoked' ? 'membership.revoked' : 'membership.activated';
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType,
        targetType: 'membership', targetId: current.id, scope, reason,
        beforeState: snapshotMembership(current), afterState: snapshotMembership(updated),
      });
      return { data: this.membershipSummary(updated), policyVersion: result.policyVersion };
    });
  }

  async listOverrides(actorUserId: string, membershipId: string, correlationId: string) {
    return this.withSnapshot(async (tx) => {
      const { contexts, policyVersion } = await this.loadActorContexts(tx, actorUserId);
      const membership = await tx.staffMembership.findUnique({ where: { id: membershipId } });
      if (!membership) throw new NotFoundException('Staff membership not found.');
      const scope = scopeFromColumns(membership);
      this.requirePermissions(contexts, actorUserId, policyVersion, scope, ['access.role.read'], {
        action: 'access.permission_override.read', targetType: 'membership', targetId: membershipId,
        scope, correlationId,
      });
      const rows = await tx.permissionOverride.findMany({ where: { membershipId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      await this.journal.recordSensitiveAccess(tx, {
        actorUserId, action: 'access.permission_override.read', targetType: 'membership', targetId: membershipId,
        scope, reason: 'Manager viewed individual permission overrides.', correlationId, policyVersion,
      });
      return { data: rows.map((row) => ({ ...overrideSnapshot(row), createdAt: row.createdAt.toISOString(), reason: row.reason })), policyVersion };
    });
  }

  async createOverride(
    actorUserId: string,
    membershipId: string,
    input: { permission: string; effect: 'allow' | 'deny'; scope: AccessScope; resource?: { type: string; id: string }; expiresAt?: string; reason: string },
    meta: AccessCommandMeta,
  ) {
    const overrideId = randomUUID();
    return this.runMutation(actorUserId, 'permission.override.grant', meta, { membershipId, ...input }, async (tx, contexts, version, replay) => {
      const membership = await tx.staffMembership.findUnique({ where: { id: membershipId }, include: { role: { include: { permissions: true } }, overrides: { where: { revokedAt: null } } } });
      if (!membership || membership.status === 'revoked') throw new NotFoundException('Active staff membership not found.');
      const membershipScope = scopeFromColumns(membership);
      const permission = getPermissionDefinition(input.permission);
      if (!permission || !permission.delegable || !permission.scopes.includes(input.scope.type) || !scopeContains(membershipScope, input.scope)) {
        throw new BadRequestException('Permission override is not valid for this membership scope.');
      }
      const audit: DeniedAuditTarget = {
        action: 'permission.override.grant', targetType: 'permission_override', targetId: overrideId,
        scope: input.scope, correlationId: meta.correlationId,
      };
      this.requirePermissions(contexts, actorUserId, version, input.scope, ['access.role.manage', 'access.permission.delegate'], audit);
      if (input.effect === 'allow') {
        this.requireDelegation(contexts, actorUserId, version, [input.permission], input.scope, audit);
      }
      await this.assertTenantScopeWritable(input.scope, { actorUserId, ...audit });
      if (replay) return replay;
      const startsAt = new Date();
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= startsAt.getTime())) {
        throw new BadRequestException('Override expiry must be in the future.');
      }
      const existing = await tx.permissionOverride.findFirst({
        where: {
          membershipId, permissionKey: input.permission, revokedAt: null,
          resourceType: input.resource?.type ?? null, resourceId: input.resource?.id ?? null,
          ...scopeColumns(input.scope),
        },
      });
      if (existing) throw new ConflictException('An active override already exists for this membership, permission and scope.');
      const administratorState = await this.captureAdministratorState(tx, [membershipScope, input.scope], version);
      const row = await tx.permissionOverride.create({
        data: {
          id: overrideId, membershipId, permissionKey: input.permission, effect: input.effect,
          ...scopeColumns(input.scope), resourceType: input.resource?.type ?? null, resourceId: input.resource?.id ?? null,
          startsAt, expiresAt, createdByUserId: actorUserId, reason: input.reason.trim(),
        },
      });
      await this.assertNoAdministratorLoss(tx, administratorState, version + 1);
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType: 'permission_override.granted',
        targetType: 'permission_override', targetId: row.id, scope: input.scope, reason: input.reason,
        afterState: overrideSnapshot(row),
      });
      return { data: { ...overrideSnapshot(row), reason: row.reason }, policyVersion: result.policyVersion };
    });
  }

  async revokeOverride(actorUserId: string, membershipId: string, overrideId: string, reason: string, meta: AccessCommandMeta) {
    return this.runMutation(actorUserId, 'permission.override.revoke', meta, { membershipId, overrideId, reason }, async (tx, contexts, version, replay) => {
      const row = await tx.permissionOverride.findFirst({ where: { id: overrideId, membershipId } });
      if (!row) throw new NotFoundException('Permission override not found.');
      const membership = await tx.staffMembership.findUnique({ where: { id: membershipId } });
      if (!membership) throw new NotFoundException('Staff membership not found.');
      const scope = scopeFromColumns(row);
      const audit: DeniedAuditTarget = {
        action: 'permission.override.revoke', targetType: 'permission_override', targetId: overrideId,
        scope, correlationId: meta.correlationId,
      };
      this.requirePermissions(contexts, actorUserId, version, scope, ['access.role.manage', 'access.permission.delegate'], audit);
      await this.assertTenantScopeWritable(scope, { actorUserId, ...audit });
      if (replay) return replay;
      if (row.revokedAt) throw new ConflictException('Permission override is already revoked.');
      const administratorState = await this.captureAdministratorState(tx, [scopeFromColumns(membership), scope], version);
      const updated = await tx.permissionOverride.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      await this.assertNoAdministratorLoss(tx, administratorState, version + 1);
      const result = await this.journal.recordCommittedChange(tx, {
        actorUserId, correlationId: meta.correlationId, changeType: 'permission_override.revoked',
        targetType: 'permission_override', targetId: row.id, scope, reason,
        beforeState: overrideSnapshot(row), afterState: overrideSnapshot(updated),
      });
      return { data: { ...overrideSnapshot(updated), reason: updated.reason }, policyVersion: result.policyVersion };
    });
  }

  async listAudit(
    actorUserId: string,
    scope: AccessScope,
    pagination: { cursor?: string; pageSize: number },
    correlationId: string,
    stepUp?: AccessCommandMeta['stepUp'],
  ) {
    this.validatePagination(pagination.pageSize);
    return this.withSnapshot(async (tx) => {
      const { contexts, policyVersion } = await this.loadActorContexts(tx, actorUserId, stepUp);
      this.requirePermissions(contexts, actorUserId, policyVersion, scope, ['audit.read'], {
        action: 'audit.read', targetType: 'membership', targetId: actorUserId,
        scope, correlationId,
      });
      const cursor = decodeAuditCursor(pagination.cursor);
      const scopeFilter: Prisma.AccessAuditLogWhereInput = scope.type === 'global'
        ? { scopeType: 'global' }
        : scope.type === 'organization'
          ? { organizationId: scope.organizationId }
          : { organizationId: scope.organizationId, OR: [{ scopeType: 'organization' }, { scopeType: 'branch', branchId: scope.branchId }] };
      const row = cursor
        ? await tx.accessAuditLog.findFirst({
            where: { id: cursor.id, createdAt: cursor.createdAt, AND: [scopeFilter] },
            select: { id: true, createdAt: true },
          })
        : null;
      if (cursor && !row) throw new BadRequestException('Audit cursor is invalid for this scope.');
      const rows = await tx.accessAuditLog.findMany({
        where: {
          AND: [
            scopeFilter,
            ...(cursor ? [{ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] : []),
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: pagination.pageSize + 1,
      });
      const hasMore = rows.length > pagination.pageSize;
      const page = rows.slice(0, pagination.pageSize);
      const last = page.at(-1);
      await this.journal.recordSensitiveAccess(tx, {
        actorUserId, action: 'audit.read', targetType: 'audit_log', targetId: actorUserId,
        scope, reason: 'Manager viewed access audit events.', correlationId, policyVersion,
      });
      return {
        data: page.map((item) => ({
          id: item.id, actorType: item.actorType, actorUserId: item.actorUserId,
          actorLabel: item.actorLabel, action: item.action, targetType: item.targetType,
          targetId: item.targetId, scope: scopeFromColumns(item), reason: item.reason,
          beforeState: item.beforeState, afterState: item.afterState,
          policyVersion: item.policyVersion, correlationId: item.correlationId,
          outcome: item.outcome, createdAt: item.createdAt.toISOString(),
        })),
        nextCursor: hasMore && last ? encodeAuditCursor(last.createdAt, last.id) : null,
        policyVersion,
      };
    });
  }

  private async runMutation<T extends Record<string, unknown>>(
    actorUserId: string,
    operation: string,
    meta: AccessCommandMeta,
    requestValue: unknown,
    work: (
      tx: Prisma.TransactionClient,
      contexts: AuthorizationContext[],
      policyVersion: number,
      replay: T | null,
    ) => Promise<T>,
  ): Promise<T> {
    this.validateCommandMeta(actorUserId, operation, meta);
    if (!areManagementWritesEnabled()) {
      await this.recordManagementWriteBlocked(actorUserId, operation, meta.correlationId);
      throw new ServiceUnavailableException('Administrative IAM writes are disabled by runtime policy.');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lock = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM "policy_state" WHERE id = 1 FOR UPDATE`;
        if (!lock.length) throw new ServiceUnavailableException('Access policy state is not initialized.');
        let prior = await tx.accessIdempotencyRecord.findUnique({
          where: { actorUserId_operation_key: { actorUserId, operation, key: meta.idempotencyKey } },
        });
        if (prior && Date.now() - prior.createdAt.getTime() >= IDEMPOTENCY_TTL_MS) {
          await tx.accessIdempotencyRecord.delete({ where: { id: prior.id } });
          prior = null;
        }
        const requestHash = this.crypto.hashRequest(operation, requestValue, prior?.requestHashKeyVersion);
        if (prior && prior.requestHash !== requestHash.hash) {
          throw new ConflictException('Idempotency key was already used for a different request.');
        }
        const { contexts, policyVersion } = await this.loadActorContexts(tx, actorUserId, meta.stepUp);
        if (prior && (!prior.responseBody || !prior.completedAt || !prior.responseStatus)) {
          throw new ServiceUnavailableException('An incomplete idempotency record requires recovery.');
        }
        const replay = prior ? (prior.responseBody as T) : null;
        const response = await work(tx, contexts, policyVersion, replay);
        if (prior) return response;

        const responseStatus = operation === 'role.create' || operation === 'permission.override.grant'
          ? 201
          : operation === 'staff.invite' ? 202 : 200;
        await tx.accessIdempotencyRecord.create({
          data: {
            actorUserId, operation, key: meta.idempotencyKey,
            requestHash: requestHash.hash, requestHashKeyVersion: requestHash.keyVersion,
            responseStatus, responseBody: response as Prisma.InputJsonObject, completedAt: new Date(),
          },
        });
        return response;
      }, { isolationLevel: 'ReadCommitted', maxWait: 4_000, timeout: 10_000 });
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        try {
          await this.prisma.$transaction((tx) => this.journal.recordDeniedAttempt(tx, {
            ...error.audit,
            reason: `Authorization denied for ${error.audit.action}.`,
          }));
        } catch {
          throw new ServiceUnavailableException('Denied access attempt could not be audited.');
        }
        throw new ForbiddenException({ status: 'error', error: { code: 'FORBIDDEN', message: 'دسترسی لازم برای این عملیات را ندارید.' } });
      }
      if (error instanceof HttpException) throw error;
      if ((error as { code?: unknown })?.code === 'P2002') {
        throw new ConflictException('The requested access record already exists.');
      }
      throw new ServiceUnavailableException('Access management transaction failed.');
    }
  }

  private async recordManagementWriteBlocked(
    actorUserId: string,
    operation: string,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction((tx) =>
        tx.accessAuditLog.create({
          data: {
            actorType: 'user',
            actorUserId,
            action: 'access.management.write_blocked',
            targetType: 'iam_operation',
            targetId: operation,
            scopeType: 'global',
            reason: 'Administrative IAM writes are disabled by runtime policy.',
            correlationId,
            outcome: 'denied',
          },
        }).then(() => undefined),
      );
    } catch {
      throw new ServiceUnavailableException('Administrative write denial could not be audited.');
    }
  }

  private async withSnapshot<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, { isolationLevel: 'RepeatableRead', maxWait: 2_000, timeout: 5_000 });
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        try {
          await this.prisma.$transaction((tx) => this.journal.recordDeniedAttempt(tx, {
            ...error.audit,
            reason: `Authorization denied for ${error.audit.action}.`,
          }));
        } catch {
          throw new ServiceUnavailableException('Denied access attempt could not be audited.');
        }
        throw new ForbiddenException({ status: 'error', error: { code: 'FORBIDDEN', message: 'دسترسی لازم برای این عملیات را ندارید.' } });
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Access management data is unavailable.');
    }
  }

  private async loadActorContexts(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    stepUp?: TrustedStepUp,
  ): Promise<{ contexts: AuthorizationContext[]; policyVersion: number }> {
    const [memberships, policy, credential] = await Promise.all([
      tx.staffMembership.findMany({
        where: { userId: actorUserId, status: 'active' },
        include: { role: { include: { permissions: true } }, overrides: { where: { revokedAt: null } } },
      }),
      tx.policyState.findUnique({ where: { id: 1 } }),
      stepUp ? tx.mfaCredential.findUnique({ where: { userId: actorUserId }, select: { status: true, version: true } }) : Promise.resolve(null),
    ]);
    if (!policy || !Number.isSafeInteger(policy.version) || policy.version < 1) {
      throw new ServiceUnavailableException('Access policy state is not initialized.');
    }
    let verifiedAt: Date | null = null;
    if (
      stepUp && credential?.status === 'active' && credential.version === stepUp.factorVersion &&
      Number.isSafeInteger(stepUp.factorVersion) && UUID_PATTERN.test(stepUp.sessionId)
    ) {
      const parsed = new Date(stepUp.verifiedAt);
      const age = Date.now() - parsed.getTime();
      if (Number.isFinite(age) && age >= 0 && age <= MFA_FRESHNESS_SECONDS * 1000) verifiedAt = parsed;
    }
    return {
      policyVersion: policy.version,
      contexts: memberships
        .filter((row) =>
          isEffectiveActiveMembership({
            status: row.status,
            createdAt: row.createdAt,
            roleName: row.role.name,
          }),
        )
        .map((row) => ({
          actorUserId,
          membership: {
            id: row.id,
            userId: row.userId,
            status: row.status,
            scope: scopeFromColumns(row),
          },
          role: {
            id: row.role.id,
            status: row.role.status,
            scope: scopeFromColumns(row.role),
            permissions: row.role.permissions.map(({ permissionKey }) => permissionKey),
          },
          overrides: row.overrides.map((item) => ({
            id: item.id,
            membershipId: item.membershipId,
            permission: item.permissionKey,
            effect: item.effect,
            scope: scopeFromColumns(item),
            ...(item.resourceType && item.resourceId
              ? { resource: { type: item.resourceType, id: item.resourceId } }
              : {}),
            startsAt: item.startsAt,
            expiresAt: item.expiresAt,
            revokedAt: item.revokedAt,
          })),
          policyVersion: policy.version,
          ...(verifiedAt ? { mfaVerifiedAt: verifiedAt } : {}),
        })),
    };
  }

  private requirePermissions(
    contexts: AuthorizationContext[], actorUserId: string, policyVersion: number,
    scope: AccessScope, permissions: string[], audit: DeniedAuditTarget,
  ): void {
    for (const permission of permissions) {
      const decision = evaluateAuthorizationAcrossMemberships(
        contexts, { permission, scope }, policyVersion, { mfaFreshnessSeconds: MFA_FRESHNESS_SECONDS },
      );
      if (!decision.allowed) throw new AccessDeniedError({ ...audit, actorUserId });
    }
  }

  private requireDelegation(
    contexts: AuthorizationContext[], actorUserId: string, policyVersion: number,
    permissions: string[], scope: AccessScope, audit: DeniedAuditTarget,
  ): void {
    const decision = evaluateDelegationAcrossMemberships(
      contexts, permissions, scope, policyVersion, { mfaFreshnessSeconds: MFA_FRESHNESS_SECONDS },
    );
    if (!decision.allowed) throw new AccessDeniedError({ ...audit, actorUserId });
  }

  private async captureAdministratorState(
    tx: Prisma.TransactionClient,
    scopes: AccessScope[],
    policyVersion: number,
  ): Promise<Map<string, { scope: AccessScope; hadAdministrator: boolean }>> {
    const uniqueScopes = new Map(scopes.map((scope) => [JSON.stringify(scope), scope]));
    if (uniqueScopes.size === 0) return new Map();
    const active = await tx.staffMembership.findMany({
      where: { status: 'active' },
      include: { role: { include: { permissions: true } }, overrides: { where: { revokedAt: null } } },
    });
    const contexts: AuthorizationContext[] = active
      .filter((row) => isEffectiveActiveMembership({
        status: row.status,
        createdAt: row.createdAt,
        roleName: row.role.name,
      }))
      .map((row) => ({
      actorUserId: row.userId,
      membership: { id: row.id, userId: row.userId, status: row.status, scope: scopeFromColumns(row) },
      role: { id: row.role.id, status: row.role.status, scope: scopeFromColumns(row.role), permissions: row.role.permissions.map(({ permissionKey }) => permissionKey) },
      overrides: row.overrides.map((item) => ({
        id: item.id, membershipId: item.membershipId, permission: item.permissionKey, effect: item.effect,
        scope: scopeFromColumns(item), ...(item.resourceType && item.resourceId ? { resource: { type: item.resourceType, id: item.resourceId } } : {}),
        startsAt: item.startsAt, expiresAt: item.expiresAt, revokedAt: item.revokedAt,
      })),
      policyVersion,
      }));
    return new Map([...uniqueScopes].map(([key, scope]) => [key, {
      scope,
      hadAdministrator: hasEffectivePermissionWithoutStepUp(contexts, { permission: 'access.role.manage', scope }, policyVersion),
    }]));
  }

  private async assertNoAdministratorLoss(
    tx: Prisma.TransactionClient,
    before: Map<string, { scope: AccessScope; hadAdministrator: boolean }>,
    policyVersion: number,
  ): Promise<void> {
    const after = await this.captureAdministratorState(tx, [...before.values()].map(({ scope }) => scope), policyVersion);
    for (const [key, prior] of before) {
      if (prior.hadAdministrator && !after.get(key)?.hadAdministrator) {
        throw new ConflictException('This change would remove the last active administrator in scope.');
      }
    }
  }

  private async roleAffectedScopes(tx: Prisma.TransactionClient, role: RoleWithPermissions): Promise<AccessScope[]> {
    const memberships = await tx.staffMembership.findMany({ where: { roleId: role.id, status: 'active' } });
    return [scopeFromColumns(role), ...memberships.map(scopeFromColumns)];
  }

  private async expireMatchingInvitations(
    tx: Prisma.TransactionClient,
    candidates: Array<{ keyVersion: string; hash: string }>,
    scope: AccessScope,
    correlationId: string,
  ): Promise<void> {
    const expired = await tx.staffInvitation.findMany({
      where: {
        status: 'pending', expiresAt: { lte: new Date() },
        OR: candidates.map(({ keyVersion, hash }) => ({ phoneLookupHashKeyVersion: keyVersion, phoneLookupHash: hash })),
        ...scopeColumns(scope),
      },
    });
    for (const invitation of expired) {
      await tx.staffInvitation.update({ where: { id: invitation.id }, data: { status: 'expired' } });
      await this.journal.recordCommittedChange(tx, {
        actorUserId: null, actorType: 'system', actorLabel: 'identity-access:invitation-expiry',
        correlationId, changeType: 'membership.invitation_expired', targetType: 'membership',
        targetId: invitation.membershipId, scope,
        reason: 'Pending staff invitation expired and was closed automatically.',
        beforeState: membershipSnapshot({ id: invitation.membershipId, status: 'pending', scope, roleId: invitation.roleId, version: 1 }),
        afterState: membershipSnapshot({ id: invitation.membershipId, status: 'revoked', scope, roleId: invitation.roleId, version: 2 }),
      });
    }
  }

  private membershipSummary(row: MembershipWithAccess) {
    return {
      membershipId: row.id, userId: row.userId, status: row.status,
      scope: scopeFromColumns(row), role: roleSummary(row.role), version: row.version,
    };
  }

  private validateCommandMeta(actorUserId: string, operation: string, meta: AccessCommandMeta): void {
    if (!UUID_PATTERN.test(actorUserId) || !UUID_PATTERN.test(meta.correlationId)) {
      throw new BadRequestException('Actor and correlation context must be valid UUIDs.');
    }
    if (!/^[a-z][a-z0-9._-]{1,119}$/.test(operation)) throw new BadRequestException('Operation name is invalid.');
    if (meta.idempotencyKey.length < 16 || meta.idempotencyKey.length > 128) {
      throw new BadRequestException('Idempotency-Key must contain 16 to 128 characters.');
    }
    if (meta.expectedVersion !== undefined && (!Number.isSafeInteger(meta.expectedVersion) || meta.expectedVersion < 1)) {
      throw new BadRequestException('If-Match version is invalid.');
    }
    if (meta.stepUp && (!UUID_PATTERN.test(meta.stepUp.sessionId) || !Number.isSafeInteger(meta.stepUp.factorVersion) || meta.stepUp.factorVersion < 1)) {
      throw new BadRequestException('Trusted step-up evidence is invalid.');
    }
  }

  private async assertTenantScopeWritable(
    scope: AccessScope,
    audit: DeniedAuditContext,
  ): Promise<void> {
    if (scope.type === 'global' || process.env.NODE_ENV !== 'production') return;

    const validation = await this.organizationScopeOwner.validateScope(scope);
    if (!validation.valid) throw new AccessDeniedError(audit);

    const organizationMatches =
      validation.organizationId.toLowerCase() === scope.organizationId.toLowerCase();
    const versionIsValid =
      Number.isSafeInteger(validation.organizationVersion) && validation.organizationVersion >= 1;
    const branchMatches =
      scope.type === 'organization'
        ? validation.branchId === undefined && validation.branchVersion === undefined
        : validation.branchId !== undefined &&
          validation.branchVersion !== undefined &&
          validation.branchId.toLowerCase() === scope.branchId.toLowerCase() &&
          Number.isSafeInteger(validation.branchVersion) &&
          validation.branchVersion >= 1;
    if (!organizationMatches || !versionIsValid || !branchMatches) {
      throw new ServiceUnavailableException(
        'Organization/branch scope validation returned inconsistent data.',
      );
    }
  }

  private validatePagination(pageSize: number): void {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('Page size must be between 1 and 100.');
    }
  }

  private requireExpectedVersion(current: number, expected: number | undefined, label: string): void {
    if (expected === undefined || current !== expected) throw new ConflictException(`${label} version is stale.`);
  }
}
