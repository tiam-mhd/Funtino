import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';
import { AccessPolicyService } from './access-policy.service.js';
import {
  ORGANIZATION_SCOPE_OWNER,
  type OrganizationScopeOwner,
} from './ports/organization-scope-owner.port.js';

export const EDGE_OPERATOR_PERMISSIONS = [
  'card.inventory.read',
  'card.inventory.manage',
  'card.assign',
  'card.transfer',
  'card.unassign',
  'customer.lookup.limited',
  'customer.provisional.create',
  'customer.family.read',
  'customer.family.manage',
  'customer.profile.manage',
] as const;

export type EdgeOperatorPermission = (typeof EDGE_OPERATOR_PERMISSIONS)[number];
export type EdgeBranchScope = { type: 'branch'; organizationId: string; branchId: string };

const tokenTtlMilliseconds = 5 * 60 * 1000;

@Injectable()
export class EdgeOperatorTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: AccessPolicyService,
    @Inject(ORGANIZATION_SCOPE_OWNER)
    private readonly organizationScopeOwner: OrganizationScopeOwner,
  ) {}

  async issue(input: {
    actorUserId: string;
    sessionId: string;
    scope: EdgeBranchScope;
    permissionKeys: EdgeOperatorPermission[];
    correlationId: string;
  }) {
    const permissionKeys = [...new Set(input.permissionKeys)].sort();
    if (permissionKeys.length === 0 || permissionKeys.length > EDGE_OPERATOR_PERMISSIONS.length) {
      throw new ForbiddenException('No Edge permissions were requested.');
    }
    const validatedScope = await this.organizationScopeOwner.validateScope(input.scope);
    if (
      !validatedScope.valid ||
      validatedScope.branchId?.toLowerCase() !== input.scope.branchId.toLowerCase() ||
      validatedScope.organizationId.toLowerCase() !== input.scope.organizationId.toLowerCase()
    ) {
      throw new ForbiddenException(
        'The branch is not active or does not belong to this organization.',
      );
    }

    const decisions = await Promise.all(
      permissionKeys.map((permission) =>
        this.accessPolicy.evaluate(input.actorUserId, { permission, scope: input.scope }),
      ),
    );
    if (decisions.some((decision) => !decision.allowed)) {
      throw new ForbiddenException(
        'The operator does not have every requested permission in this branch.',
      );
    }
    const policyVersion = decisions[0]!.policyVersion;
    const catalogVersion = decisions[0]!.catalogVersion;
    if (
      decisions.some(
        (decision) =>
          decision.policyVersion !== policyVersion || decision.catalogVersion !== catalogVersion,
      )
    ) {
      throw new ConflictException('Access policy changed while issuing the Edge token; retry.');
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + tokenTtlMilliseconds);
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(secret, 'utf8').digest('hex');
    await this.prisma.$transaction(async (tx) => {
      await tx.edgeOperatorToken.create({
        data: {
          id,
          tokenHash,
          actorUserId: input.actorUserId,
          sessionId: input.sessionId,
          organizationId: input.scope.organizationId,
          branchId: input.scope.branchId,
          permissionKeys: permissionKeys as unknown as Prisma.InputJsonArray,
          policyVersion,
          catalogVersion,
          issuedAt,
          expiresAt,
        },
      });
      await tx.edgeOperatorTokenAudit.create({
        data: {
          tokenId: id,
          actorUserId: input.actorUserId,
          action: 'issued',
          organizationId: input.scope.organizationId,
          branchId: input.scope.branchId,
          permissionKeys: permissionKeys as unknown as Prisma.InputJsonArray,
          correlationId: input.correlationId,
        },
      });
    });
    return {
      token: secret,
      tokenId: id,
      permissionKeys,
      branchId: input.scope.branchId,
      expiresAt: expiresAt.toISOString(),
      policyVersion,
      catalogVersion,
    };
  }

  async validate(input: { token: string; branchId: string; permission: EdgeOperatorPermission }) {
    if (input.token.length < 32 || input.token.length > 256)
      throw new UnauthorizedException('Edge operator token is invalid.');
    const tokenHash = createHash('sha256').update(input.token, 'utf8').digest('hex');
    const now = new Date();
    const token = await this.prisma.edgeOperatorToken.findUnique({ where: { tokenHash } });
    if (
      !token ||
      token.revokedAt ||
      token.expiresAt <= now ||
      token.branchId.toLowerCase() !== input.branchId.toLowerCase()
    ) {
      throw new UnauthorizedException('Edge operator token is invalid or expired.');
    }
    const permissions = parsePermissionKeys(token.permissionKeys);
    if (!permissions.includes(input.permission))
      throw new ForbiddenException('Edge operator permission is not present in the token.');

    const scope: EdgeBranchScope = {
      type: 'branch',
      organizationId: token.organizationId,
      branchId: token.branchId,
    };
    const validatedScope = await this.organizationScopeOwner.validateScope(scope);
    if (
      !validatedScope.valid ||
      validatedScope.organizationId.toLowerCase() !== token.organizationId.toLowerCase() ||
      validatedScope.branchId?.toLowerCase() !== token.branchId.toLowerCase()
    ) {
      throw new UnauthorizedException('Edge operator branch scope is no longer active.');
    }
    const decision = await this.accessPolicy.evaluate(token.actorUserId, {
      permission: input.permission,
      scope,
    });
    if (!decision.allowed)
      throw new ForbiddenException('Edge operator permission is no longer active.');

    const marked = await this.prisma.edgeOperatorToken.updateMany({
      where: { id: token.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
    if (marked.count !== 1)
      throw new UnauthorizedException('Edge operator token is invalid or expired.');
    return {
      tokenId: token.id,
      actorUserId: token.actorUserId,
      organizationId: token.organizationId,
      branchId: token.branchId,
      permission: input.permission,
      expiresAt: token.expiresAt.toISOString(),
      policyVersion: decision.policyVersion,
      catalogVersion: decision.catalogVersion,
    };
  }

  async revokeSession(input: { actorUserId: string; sessionId: string; correlationId: string }) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.edgeOperatorToken.findMany({
        where: {
          actorUserId: input.actorUserId,
          sessionId: input.sessionId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true, organizationId: true, branchId: true, permissionKeys: true },
      });
      if (!active.length) return { revokedCount: 0 };
      const result = await tx.edgeOperatorToken.updateMany({
        where: { id: { in: active.map((item) => item.id) }, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.edgeOperatorTokenAudit.createMany({
        data: active.map((item) => ({
          tokenId: item.id,
          actorUserId: input.actorUserId,
          action: 'revoked',
          organizationId: item.organizationId,
          branchId: item.branchId,
          permissionKeys: item.permissionKeys as Prisma.InputJsonArray,
          correlationId: input.correlationId,
        })),
      });
      return { revokedCount: result.count };
    });
  }
}

function parsePermissionKeys(value: Prisma.JsonValue): EdgeOperatorPermission[] {
  if (
    !Array.isArray(value) ||
    value.length > EDGE_OPERATOR_PERMISSIONS.length ||
    value.some(
      (item) =>
        typeof item !== 'string' ||
        !EDGE_OPERATOR_PERMISSIONS.includes(item as EdgeOperatorPermission),
    )
  ) {
    throw new UnauthorizedException('Edge operator token permissions are invalid.');
  }
  return value as EdgeOperatorPermission[];
}
