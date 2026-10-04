import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/index.js';
import { permissionCatalog } from '../domain/authorization/permission-catalog.js';
import {
  BOOTSTRAP_MEMBERSHIP_TTL_MS,
  isBootstrapMembershipExpired,
  SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME,
} from '../domain/authorization/bootstrap-membership.js';
import { AccessMutationJournalService } from '../application/access-mutation-journal.service.js';
import { MfaService } from '../application/mfa.service.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

const BOOTSTRAP_ROLE_NAME = SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME;
const SYSTEM_ADMIN_ROLE_NAME = 'system_admin';
// These non-delegable operational permissions are explicitly held by the protected global admin role.
// Bootstrap and impersonation remain separate privileges.
const SYSTEM_ADMIN_REQUIRED_PERMISSION_KEYS = [
  'organization.create',
  'system.session_policy.manage',
] as const;

type ProtectedRole = {
  id: string;
  name: string;
  scopeType: 'global' | 'organization' | 'branch';
  status: 'active' | 'disabled';
  systemManaged: boolean;
  version: number;
  permissions: Array<{ permissionKey: string }>;
};

function sortedPermissionKeys(role: ProtectedRole): string[] {
  return role.permissions.map(({ permissionKey }) => permissionKey).sort();
}

function legacySystemAdminPermissionKeys(): string[] {
  return permissionCatalog
    .filter((permission) => permission.delegable)
    .map((permission) => permission.key)
    .sort();
}

function previouslyCurrentSystemAdminPermissionKeys(): string[] {
  return [...new Set([...legacySystemAdminPermissionKeys(), 'organization.create'])].sort();
}

function systemAdminPermissionKeys(): string[] {
  return [
    ...new Set([...legacySystemAdminPermissionKeys(), ...SYSTEM_ADMIN_REQUIRED_PERMISSION_KEYS]),
  ].sort();
}

function systemAdminPermissionState(role: ProtectedRole): 'current' | 'legacy' | 'inconsistent' {
  if (
    role.name !== SYSTEM_ADMIN_ROLE_NAME ||
    role.scopeType !== 'global' ||
    !role.systemManaged ||
    role.status !== 'active'
  )
    return 'inconsistent';
  const actual = sortedPermissionKeys(role).join('|');
  if (actual === systemAdminPermissionKeys().join('|')) return 'current';
  if (
    actual === legacySystemAdminPermissionKeys().join('|') ||
    actual === previouslyCurrentSystemAdminPermissionKeys().join('|')
  )
    return 'legacy';
  return 'inconsistent';
}

function roleSnapshot(role: ProtectedRole) {
  return {
    kind: 'role' as const,
    id: role.id,
    name: role.name,
    status: role.status,
    scope: { type: 'global' as const },
    systemManaged: role.systemManaged,
    version: role.version,
    permissionKeys: sortedPermissionKeys(role),
  };
}

@Injectable()
export class AccessBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: AccessMutationJournalService,
    private readonly mfa: MfaService,
  ) {}

  /** Offline-only phase one: grants no ordinary administrative permission. */
  async prepare(input: { userId: string; operatorLabel: string; reason: string }) {
    const membershipId = randomUUID();
    const roleId = randomUUID();
    const now = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockPolicy(tx);
        const existingAdmin = await tx.staffMembership.findFirst({
          where: {
            scopeType: 'global',
            status: { not: 'revoked' },
            role: { is: { name: SYSTEM_ADMIN_ROLE_NAME, systemManaged: true } },
          },
        });
        if (existingAdmin)
          throw new ConflictException('A global system administrator already exists.');
        const bootstrapRole = await tx.accessRole.findFirst({
          where: { scopeType: 'global', name: BOOTSTRAP_ROLE_NAME },
          include: { permissions: true },
        });
        if (
          bootstrapRole &&
          (!bootstrapRole.systemManaged ||
            bootstrapRole.status !== 'active' ||
            bootstrapRole.permissions.length !== 1 ||
            bootstrapRole.permissions[0]?.permissionKey !== 'system.access.bootstrap')
        ) {
          throw new ConflictException('The protected bootstrap role is inconsistent.');
        }
        const role =
          bootstrapRole ??
          (await tx.accessRole.create({
            data: {
              id: roleId,
              name: BOOTSTRAP_ROLE_NAME,
              scopeType: 'global',
              systemManaged: true,
              permissions: { create: [{ permissionKey: 'system.access.bootstrap' }] },
            },
            include: { permissions: true },
          }));
        const occupiedMemberships = await tx.staffMembership.findMany({
          where: { roleId: role.id, status: { not: 'revoked' } },
        });
        for (const occupied of occupiedMemberships) {
          if (!isBootstrapMembershipExpired(BOOTSTRAP_ROLE_NAME, occupied.createdAt, now)) {
            throw new ConflictException('A bootstrap membership is already in progress.');
          }
          const revoked = await tx.staffMembership.update({
            where: { id: occupied.id },
            data: { status: 'revoked', version: { increment: 1 } },
          });
          await this.journal.recordCommittedChange(tx, {
            actorUserId: null,
            actorType: 'system',
            actorLabel: input.operatorLabel,
            correlationId: randomUUID(),
            changeType: 'membership.revoked',
            targetType: 'membership',
            targetId: occupied.id,
            scope: { type: 'global' },
            reason: 'Expired bootstrap membership was revoked before a new preparation.',
            beforeState: {
              kind: 'membership',
              id: occupied.id,
              status: occupied.status,
              scope: { type: 'global' },
              roleId: role.id,
              version: occupied.version,
            },
            afterState: {
              kind: 'membership',
              id: revoked.id,
              status: 'revoked',
              scope: { type: 'global' },
              roleId: role.id,
              version: revoked.version,
            },
          });
        }
        const priorMembership = await tx.staffMembership.findFirst({
          where: { userId: input.userId, scopeType: 'global', status: { not: 'revoked' } },
        });
        if (priorMembership)
          throw new ConflictException('The target user already has a global membership.');

        if (!bootstrapRole) {
          await this.journal.recordCommittedChange(tx, {
            actorUserId: null,
            actorType: 'system',
            actorLabel: input.operatorLabel,
            correlationId: randomUUID(),
            changeType: 'role.created',
            targetType: 'role',
            targetId: role.id,
            scope: { type: 'global' },
            reason: input.reason,
            afterState: {
              kind: 'role',
              id: role.id,
              name: role.name,
              status: role.status,
              scope: { type: 'global' },
              systemManaged: true,
              version: role.version,
              permissionKeys: ['system.access.bootstrap'],
            },
          });
        }

        const membership = await tx.staffMembership.create({
          data: {
            id: membershipId,
            userId: input.userId,
            scopeType: 'global',
            roleId: role.id,
            status: 'active',
            version: 1,
          },
        });
        await this.journal.recordCommittedChange(tx, {
          actorUserId: null,
          actorType: 'system',
          actorLabel: input.operatorLabel,
          correlationId: randomUUID(),
          changeType: 'membership.activated',
          targetType: 'membership',
          targetId: membership.id,
          scope: { type: 'global' },
          reason: input.reason,
          beforeState: {
            kind: 'membership',
            id: membership.id,
            status: 'pending',
            scope: { type: 'global' },
            roleId: role.id,
            version: 1,
          },
          afterState: {
            kind: 'membership',
            id: membership.id,
            status: 'active',
            scope: { type: 'global' },
            roleId: role.id,
            version: 1,
          },
        });
        return {
          status: 'prepared' as const,
          userId: input.userId,
          membershipId: membership.id,
          role: BOOTSTRAP_ROLE_NAME,
          expiresAt: new Date(
            membership.createdAt.getTime() + BOOTSTRAP_MEMBERSHIP_TTL_MS,
          ).toISOString(),
        };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 4_000, timeout: 10_000 },
    );
  }

  /** Offline-only phase two. Consumes a fresh one-time MFA proof before promotion. */
  async finalize(input: {
    userId: string;
    operatorLabel: string;
    reason: string;
    code: string;
    method: 'totp' | 'recovery';
  }) {
    const preparedMembership = await this.prisma.staffMembership.findFirst({
      where: { userId: input.userId, scopeType: 'global', status: 'active' },
      include: { role: { include: { permissions: true } } },
    });
    if (!preparedMembership)
      throw new ConflictException('No active global bootstrap membership exists.');
    const existingAdminState =
      preparedMembership.role.name === SYSTEM_ADMIN_ROLE_NAME
        ? systemAdminPermissionState(preparedMembership.role)
        : null;
    if (existingAdminState === 'current') {
      return {
        status: 'already_finalized' as const,
        userId: input.userId,
        role: SYSTEM_ADMIN_ROLE_NAME,
      };
    }
    if (existingAdminState === 'inconsistent') {
      throw new ConflictException('The protected system administrator role is inconsistent.');
    }
    const bootstrapRoleIsValid =
      preparedMembership.role.name === BOOTSTRAP_ROLE_NAME &&
      preparedMembership.role.systemManaged &&
      preparedMembership.role.status === 'active' &&
      preparedMembership.role.scopeType === 'global' &&
      sortedPermissionKeys(preparedMembership.role).join('|') === 'system.access.bootstrap' &&
      !isBootstrapMembershipExpired(preparedMembership.role.name, preparedMembership.createdAt);
    if (existingAdminState === null && !bootstrapRoleIsValid) {
      throw new ConflictException(
        'The global membership is not in a current protected bootstrap state.',
      );
    }
    const verified = await this.mfa.verifyStepUp(
      { actorUserId: input.userId, sessionId: randomUUID(), correlationId: randomUUID() },
      { method: input.method, code: input.code },
    );
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockPolicy(tx);
        const membership = await tx.staffMembership.findFirst({
          where: { userId: input.userId, scopeType: 'global', status: 'active' },
          include: { role: { include: { permissions: true } } },
        });
        if (!membership)
          throw new ConflictException('No active global bootstrap membership exists.');
        const currentAdminState =
          membership.role.name === SYSTEM_ADMIN_ROLE_NAME
            ? systemAdminPermissionState(membership.role)
            : null;
        if (currentAdminState === 'inconsistent') {
          throw new ConflictException('The protected system administrator role is inconsistent.');
        }
        const bootstrapRoleIsCurrent =
          membership.role.name === BOOTSTRAP_ROLE_NAME &&
          membership.role.systemManaged &&
          membership.role.status === 'active' &&
          membership.role.scopeType === 'global' &&
          sortedPermissionKeys(membership.role).join('|') === 'system.access.bootstrap' &&
          !isBootstrapMembershipExpired(membership.role.name, membership.createdAt);
        if (currentAdminState === null && !bootstrapRoleIsCurrent) {
          throw new ConflictException(
            'The global membership is not in a current protected bootstrap state.',
          );
        }
        const credential = await tx.mfaCredential.findUnique({ where: { userId: input.userId } });
        if (
          !credential ||
          credential.status !== 'active' ||
          credential.version !== verified.factorVersion
        ) {
          throw new ConflictException('MFA must remain active at the verified factor version.');
        }

        if (currentAdminState === 'current') {
          return {
            status: 'already_finalized' as const,
            userId: input.userId,
            role: SYSTEM_ADMIN_ROLE_NAME,
          };
        }
        if (currentAdminState === 'legacy') {
          const { role, changed } = await this.reconcileSystemAdminPermissions(
            tx,
            membership.role,
            input,
          );
          return {
            status: changed ? ('permissions_reconciled' as const) : ('already_finalized' as const),
            userId: input.userId,
            role: role.name,
          };
        }

        let role = await tx.accessRole.findFirst({
          where: { scopeType: 'global', name: SYSTEM_ADMIN_ROLE_NAME },
          include: { permissions: true },
        });
        const permissionKeys = systemAdminPermissionKeys();
        if (role && systemAdminPermissionState(role) === 'inconsistent') {
          throw new ConflictException('The protected system administrator role is inconsistent.');
        }
        if (role && systemAdminPermissionState(role) === 'legacy') {
          await this.reconcileSystemAdminPermissions(tx, role, input);
        }
        if (!role) {
          role = await tx.accessRole.create({
            data: {
              id: randomUUID(),
              name: SYSTEM_ADMIN_ROLE_NAME,
              scopeType: 'global',
              systemManaged: true,
              permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) },
            },
            include: { permissions: true },
          });
          await this.journal.recordCommittedChange(tx, {
            actorUserId: null,
            actorType: 'system',
            actorLabel: input.operatorLabel,
            correlationId: randomUUID(),
            changeType: 'role.created',
            targetType: 'role',
            targetId: role.id,
            scope: { type: 'global' },
            reason: input.reason,
            afterState: roleSnapshot(role),
          });
        }
        const updated = await tx.staffMembership.update({
          where: { id: membership.id },
          data: { roleId: role.id, version: { increment: 1 } },
        });
        await this.journal.recordCommittedChange(tx, {
          actorUserId: null,
          actorType: 'system',
          actorLabel: input.operatorLabel,
          correlationId: randomUUID(),
          changeType: 'membership.role_changed',
          targetType: 'membership',
          targetId: membership.id,
          scope: { type: 'global' },
          reason: input.reason,
          beforeState: {
            kind: 'membership',
            id: membership.id,
            status: 'active',
            scope: { type: 'global' },
            roleId: membership.roleId,
            version: membership.version,
          },
          afterState: {
            kind: 'membership',
            id: updated.id,
            status: 'active',
            scope: { type: 'global' },
            roleId: role.id,
            version: updated.version,
          },
        });
        return {
          status: 'finalized' as const,
          userId: input.userId,
          membershipId: membership.id,
          role: SYSTEM_ADMIN_ROLE_NAME,
        };
      },
      { isolationLevel: 'ReadCommitted', maxWait: 4_000, timeout: 10_000 },
    );
  }

  private async reconcileSystemAdminPermissions(
    tx: Prisma.TransactionClient,
    role: ProtectedRole,
    input: { operatorLabel: string; reason: string },
  ): Promise<{ role: ProtectedRole; changed: boolean }> {
    if (systemAdminPermissionState(role) === 'current') return { role, changed: false };
    if (systemAdminPermissionState(role) !== 'legacy') {
      throw new ConflictException('The protected system administrator role is inconsistent.');
    }
    const currentKeys = new Set(sortedPermissionKeys(role));
    const permissionsToAdd = systemAdminPermissionKeys().filter((key) => !currentKeys.has(key));
    const updated = await tx.accessRole.update({
      where: { id: role.id },
      data: {
        version: { increment: 1 },
        permissions: { create: permissionsToAdd.map((permissionKey) => ({ permissionKey })) },
      },
      include: { permissions: true },
    });
    await this.journal.recordCommittedChange(tx, {
      actorUserId: null,
      actorType: 'system',
      actorLabel: input.operatorLabel,
      correlationId: randomUUID(),
      changeType: 'role.updated',
      targetType: 'role',
      targetId: updated.id,
      scope: { type: 'global' },
      reason: input.reason,
      beforeState: roleSnapshot(role),
      afterState: roleSnapshot(updated),
    });
    return { role: updated, changed: true };
  }

  private async lockPolicy(tx: Prisma.TransactionClient): Promise<void> {
    const rows = await tx.$queryRaw<
      Array<{ id: number }>
    >`SELECT id FROM "policy_state" WHERE id = 1 FOR UPDATE`;
    if (!rows.length) throw new ConflictException('Access policy state is not initialized.');
  }
}
