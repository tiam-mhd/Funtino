import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/index.js';
import {
  evaluateAuthorizationAcrossMemberships,
  type AccessScope,
  type AuthorizationContext,
  type AuthorizationRequest,
} from '../domain/authorization/authorization-evaluator.js';
import {
  permissionCatalog,
  permissionCatalogVersion,
} from '../domain/authorization/permission-catalog.js';
import {
  isBootstrapMembershipExpired,
  isEffectiveActiveMembership,
} from '../domain/authorization/bootstrap-membership.js';
import { mfaFreshnessSecondsForContexts } from '../domain/authorization/mfa-policy.js';
import { templatesForScope } from '../domain/authorization/role-templates.js';
import {
  AccessMutationJournalService,
  type RecordDeniedAccessAttempt,
} from './access-mutation-journal.service.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

type PolicyMembership = Prisma.StaffMembershipGetPayload<{
  include: {
    role: { include: { permissions: true } };
    overrides: { where: { revokedAt: null } };
  };
}>;

type RoleRecord = Prisma.AccessRoleGetPayload<{ include: { permissions: true } }>;

export type RoleSummary = {
  id: string;
  name: string;
  scope: AccessScope;
  permissionKeys: string[];
  systemManaged: boolean;
  status: 'active' | 'disabled';
  version: number;
};

class AccessPolicyDeniedError extends Error {
  constructor(readonly audit: RecordDeniedAccessAttempt) {
    super('ACCESS_POLICY_READ_DENIED');
    this.name = 'AccessPolicyDeniedError';
  }
}

function scopeFromColumns(
  type: string,
  organizationId: string | null,
  branchId: string | null,
): AccessScope {
  if (type === 'global' && organizationId === null && branchId === null) return { type: 'global' };
  if (type === 'organization' && organizationId && branchId === null) {
    return { type: 'organization', organizationId };
  }
  if (type === 'branch' && organizationId && branchId) {
    return { type: 'branch', organizationId, branchId };
  }
  throw new ServiceUnavailableException('Stored access scope is invalid.');
}

function summarizeRole(role: RoleRecord): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    scope: scopeFromColumns(role.scopeType, role.organizationId, role.branchId),
    permissionKeys: role.permissions.map(({ permissionKey }) => permissionKey).sort(),
    systemManaged: role.systemManaged,
    status: role.status,
    version: role.version,
  };
}

function authorizationContext(
  row: PolicyMembership,
  policyVersion: number,
  mfaVerifiedAt?: Date | null,
): AuthorizationContext {
  return {
    actorUserId: row.userId,
    membership: {
      id: row.id,
      userId: row.userId,
      status: row.status,
      scope: scopeFromColumns(row.scopeType, row.organizationId, row.branchId),
    },
    role: {
      id: row.role.id,
      status: row.role.status,
      scope: scopeFromColumns(row.role.scopeType, row.role.organizationId, row.role.branchId),
      permissions: row.role.permissions.map(({ permissionKey }) => permissionKey),
    },
    overrides: row.overrides.map((override) => ({
      id: override.id,
      membershipId: override.membershipId,
      permission: override.permissionKey,
      effect: override.effect,
      scope: scopeFromColumns(override.scopeType, override.organizationId, override.branchId),
      ...(override.resourceType && override.resourceId
        ? { resource: { type: override.resourceType, id: override.resourceId } }
        : {}),
      startsAt: override.startsAt,
      expiresAt: override.expiresAt,
      revokedAt: override.revokedAt,
    })),
    policyVersion,
    ...(mfaVerifiedAt ? { mfaVerifiedAt } : {}),
  };
}

function isScopeApplicable(role: RoleSummary, target: AccessScope): boolean {
  if (role.scope.type === 'global') return target.type === 'global';
  if (target.type === 'global' || role.scope.organizationId !== target.organizationId) return false;
  if (role.scope.type === 'organization') return true;
  return target.type === 'branch' && role.scope.branchId === target.branchId;
}

@Injectable()
export class AccessPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AccessMutationJournalService,
  ) {}

  permissionCatalog() {
    return { catalogVersion: permissionCatalogVersion, data: permissionCatalog };
  }

  async currentMemberships(userId: string) {
    return this.inSnapshot(async (tx) => {
      const [memberships, policy] = await Promise.all([
        tx.staffMembership.findMany({
          where: { userId, status: { not: 'revoked' } },
          include: { role: { include: { permissions: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        tx.policyState.findUnique({ where: { id: 1 } }),
      ]);
      const policyVersion = this.requirePolicyVersion(policy?.version);
      return {
        data: memberships
          .filter(
            (membership) =>
              !isBootstrapMembershipExpired(membership.role.name, membership.createdAt),
          )
          .map((membership) => ({
            id: membership.id,
            status: membership.status,
            scope: scopeFromColumns(
              membership.scopeType,
              membership.organizationId,
              membership.branchId,
            ),
            role: summarizeRole(membership.role),
            version: membership.version,
          })),
        policyVersion,
        catalogVersion: permissionCatalogVersion,
        managementSessionTtlHours: policy?.managementSessionTtlHours ?? 12,
      };
    });
  }

  async evaluate(
    userId: string,
    request: AuthorizationRequest,
    stepUp?: { verifiedAt: Date; factorVersion: number; method: 'totp' | 'recovery' },
  ) {
    return this.inSnapshot(async (tx) => {
      const { contexts, policyVersion } = await this.loadContexts(tx, userId, stepUp);
      const decision = evaluateAuthorizationAcrossMemberships(contexts, request, policyVersion, {
        mfaFreshnessSeconds: mfaFreshnessSecondsForContexts(contexts),
      });
      return {
        allowed: decision.allowed,
        reason: decision.reason,
        policyVersion,
        catalogVersion: permissionCatalogVersion,
      };
    });
  }

  async managementSessionPolicy(userId: string, correlationId: string) {
    return this.inSnapshot(async (tx) => {
      const [{ contexts, policyVersion }, policy] = await Promise.all([
        this.loadContexts(tx, userId),
        tx.policyState.findUnique({ where: { id: 1 } }),
      ]);
      if (!policy) throw new ServiceUnavailableException('Access policy state is not initialized.');
      const decision = evaluateAuthorizationAcrossMemberships(
        contexts,
        { permission: 'system.session_policy.manage', scope: { type: 'global' } },
        policyVersion,
        { mfaFreshnessSeconds: mfaFreshnessSecondsForContexts(contexts) },
      );
      if (!decision.allowed) {
        throw new AccessPolicyDeniedError({
          actorUserId: userId,
          action: 'system.session_policy.read',
          targetType: 'system_setting',
          targetId: 'management_session_policy',
          scope: { type: 'global' },
          reason: 'Actor lacked system.session_policy.manage permission.',
          correlationId,
        });
      }
      await this.journal.recordSensitiveAccess(tx, {
        actorUserId: userId,
        action: 'system.session_policy.read',
        targetType: 'system_setting',
        targetId: 'management_session_policy',
        scope: { type: 'global' },
        reason: 'System administrator viewed the management session policy.',
        correlationId,
        policyVersion,
      });
      return {
        managementSessionTtlHours: policy.managementSessionTtlHours,
        policyVersion,
      };
    });
  }

  async listRoles(
    userId: string,
    organizationId: string,
    branchId?: string,
    pagination: { cursor?: string; pageSize: number } = { pageSize: 25 },
  ): Promise<{ status: 'success'; data: RoleSummary[]; nextCursor: string | null }> {
    const targetScope: AccessScope = branchId
      ? { type: 'branch', organizationId, branchId }
      : { type: 'organization', organizationId };
    return this.listRolesInScope(userId, targetScope, pagination, randomUUID());
  }

  async listRolesInScope(
    userId: string,
    targetScope: AccessScope,
    pagination: { cursor?: string; pageSize: number } = { pageSize: 25 },
    correlationId: string = randomUUID(),
  ): Promise<{ status: 'success'; data: RoleSummary[]; nextCursor: string | null }> {
    if (
      !Number.isSafeInteger(pagination.pageSize) ||
      pagination.pageSize < 1 ||
      pagination.pageSize > 100
    ) {
      throw new BadRequestException('Invalid role page size.');
    }

    return this.inSnapshot(async (tx) => {
      const { contexts, policyVersion } = await this.loadContexts(tx, userId);
      const decision = evaluateAuthorizationAcrossMemberships(
        contexts,
        { permission: 'access.role.read', scope: targetScope },
        policyVersion,
      );
      if (!decision.allowed) {
        throw new AccessPolicyDeniedError({
          actorUserId: userId,
          action: 'access.role.read',
          targetType: 'role',
          targetId: userId,
          scope: targetScope,
          reason: 'Actor lacked access.role.read permission in the requested scope.',
          correlationId,
        });
      }

      const candidates = await tx.accessRole.findMany({
        where: {
          ...(pagination.cursor ? { id: { gt: pagination.cursor } } : {}),
          ...(targetScope.type === 'global'
            ? { scopeType: 'global', organizationId: null, branchId: null }
            : targetScope.type === 'branch'
              ? {
                  organizationId: targetScope.organizationId,
                  OR: [
                    { scopeType: 'organization', branchId: null },
                    { scopeType: 'branch', branchId: targetScope.branchId },
                  ],
                }
              : {
                  scopeType: 'organization',
                  organizationId: targetScope.organizationId,
                  branchId: null,
                }),
        },
        include: { permissions: true },
        orderBy: { id: 'asc' },
        take: pagination.pageSize + 1,
      });
      const hasMore = candidates.length > pagination.pageSize;
      const page = candidates.slice(0, pagination.pageSize);
      await this.journal.recordSensitiveAccess(tx, {
        actorUserId: userId,
        action: 'access.role.read',
        targetType: 'role',
        targetId: userId,
        scope: targetScope,
        reason: 'Manager viewed role and permission definitions.',
        correlationId,
        policyVersion,
      });
      return {
        status: 'success',
        data: page.map(summarizeRole).filter((role) => isScopeApplicable(role, targetScope)),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  async roleTemplates(
    userId: string,
    targetScope: AccessScope,
    correlationId: string = randomUUID(),
  ) {
    return this.inSnapshot(async (tx) => {
      const { contexts, policyVersion } = await this.loadContexts(tx, userId);
      const decision = evaluateAuthorizationAcrossMemberships(
        contexts,
        { permission: 'access.role.read', scope: targetScope },
        policyVersion,
      );
      if (!decision.allowed) {
        throw new AccessPolicyDeniedError({
          actorUserId: userId,
          action: 'access.role.read',
          targetType: 'role',
          targetId: userId,
          scope: targetScope,
          reason: 'Actor lacked access.role.read permission in the requested scope.',
          correlationId,
        });
      }
      await this.journal.recordSensitiveAccess(tx, {
        actorUserId: userId,
        action: 'access.role.read',
        targetType: 'role',
        targetId: userId,
        scope: targetScope,
        reason: 'Manager viewed role templates.',
        correlationId,
        policyVersion,
      });
      return {
        policyVersion,
        catalogVersion: permissionCatalogVersion,
        data: templatesForScope(targetScope.type),
      };
    });
  }

  private async inSnapshot<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: 'RepeatableRead',
        maxWait: 2_000,
        timeout: 4_000,
      });
    } catch (error) {
      if (error instanceof AccessPolicyDeniedError) {
        try {
          await this.prisma.$transaction((tx) =>
            this.journal.recordDeniedAttempt(tx, {
              ...error.audit,
              reason: `Authorization denied for ${error.audit.action}.`,
            }),
          );
        } catch {
          throw new ServiceUnavailableException('Denied access attempt could not be audited.');
        }
        throw new ForbiddenException({
          status: 'error',
          error: {
            code: 'FORBIDDEN',
            message: 'دسترسی مشاهده‌ی دسترسی‌ها در این محدوده مجاز نیست.',
          },
        });
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('The access policy source is unavailable.');
    }
  }

  private async loadContexts(
    tx: Prisma.TransactionClient,
    userId: string,
    stepUp?: { verifiedAt: Date; factorVersion: number; method: 'totp' | 'recovery' },
  ) {
    const [memberships, policy, credential] = await Promise.all([
      tx.staffMembership.findMany({
        where: { userId, status: 'active' },
        include: {
          role: { include: { permissions: true } },
          overrides: { where: { revokedAt: null } },
        },
      }),
      tx.policyState.findUnique({ where: { id: 1 } }),
      stepUp
        ? tx.mfaCredential.findUnique({
            where: { userId },
            select: { status: true, version: true },
          })
        : Promise.resolve(null),
    ]);
    const policyVersion = this.requirePolicyVersion(policy?.version);
    return {
      contexts: memberships
        .filter((membership) =>
          isEffectiveActiveMembership({
            status: membership.status,
            createdAt: membership.createdAt,
            roleName: membership.role.name,
          }),
        )
        .map((membership) =>
          authorizationContext(
            membership,
            policyVersion,
            credential?.status === 'active' && credential.version === stepUp?.factorVersion
              ? stepUp.verifiedAt
              : null,
          ),
        ),
      policyVersion,
    };
  }

  private requirePolicyVersion(version: number | undefined): number {
    if (!Number.isSafeInteger(version) || (version ?? 0) < 1) {
      throw new ServiceUnavailableException('The access policy source is not initialized.');
    }
    return version!;
  }
}
