import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import { AuthService } from '../../application/auth/auth.service.js';
import type {
  AccessScopeDto,
  OperationsAccessContext,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { IdentityAccessClient } from '../../infrastructure/identity-access/identity-access.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const tenantScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('organization'), organizationId: uuid }).strict(),
  z.object({ type: z.literal('branch'), organizationId: uuid, branchId: uuid }).strict(),
]);
const scopeSelectionSchema = z.object({ scope: tenantScopeSchema }).strict();
const scopePageSize = 8;
const inheritedBranchPageSize = 100;
const maxInheritedBranchPages = 100;

type TenantScope = z.infer<typeof tenantScopeSchema>;
type ScopeCandidate = { scope: TenantScope };
type OperationsScopeOption = {
  scope: TenantScope;
  organization: { id: string; name: string };
  branch?: { id: string; name: string; city: string };
};

@Controller('api/v1/operations')
@UseGuards(SessionGuard)
export class OperationsScopeController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly auth: AuthService,
  ) {}

  @Get('scopes')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async listScopes(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    const correlationId = requestCorrelationId(request);
    const context = await this.identityAccess.currentAccessContext(user.id, correlationId);
    const candidates = this.candidates(context);
    const organizationScopes = candidates.filter(
      (candidate): candidate is { scope: Extract<TenantScope, { type: 'organization' }> } =>
        candidate.scope.type === 'organization',
    );
    const organizationIds = new Set(
      organizationScopes.map((candidate) => candidate.scope.organizationId.toLowerCase()),
    );
    const items: OperationsScopeOption[] = [];
    for (let index = 0; index < organizationScopes.length; index += scopePageSize) {
      const batch = organizationScopes.slice(index, index + scopePageSize);
      const inheritedOptions = await Promise.all(
        batch.map((candidate) => this.listOrganizationScopeOptions(candidate.scope)),
      );
      items.push(...inheritedOptions.flat());
    }
    const directBranchScopes = candidates.filter(
      (candidate): candidate is { scope: Extract<TenantScope, { type: 'branch' }> } =>
        candidate.scope.type === 'branch' &&
        !organizationIds.has(candidate.scope.organizationId.toLowerCase()),
    );

    for (let index = 0; index < directBranchScopes.length; index += scopePageSize) {
      const batch = directBranchScopes.slice(index, index + scopePageSize);
      const resolved = await Promise.all(batch.map(({ scope }) => this.resolveActiveScope(scope)));
      items.push(...resolved.filter((item): item is OperationsScopeOption => item !== null));
    }

    items.sort((left, right) => {
      const organizationOrder = left.organization.name.localeCompare(right.organization.name, 'fa');
      if (organizationOrder !== 0) return organizationOrder;
      const leftBranch = left.branch?.name ?? '';
      const rightBranch = right.branch?.name ?? '';
      return (
        leftBranch.localeCompare(rightBranch, 'fa') ||
        left.scope.type.localeCompare(right.scope.type)
      );
    });

    return success({ items, policyVersion: context.policyVersion }, request);
  }

  @Post('scope-selection')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store, private')
  async selectScope(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(scopeSelectionSchema)) body: { scope: TenantScope },
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const context = await this.identityAccess.currentAccessContext(user.id, correlationId);
    const candidates = this.candidates(context);
    const directCandidate = candidates.find(({ scope }) => sameScope(scope, body.scope));
    const inheritedFromOrganization =
      body.scope.type === 'branch' &&
      candidates.some(
        ({ scope }) =>
          scope.type === 'organization' &&
          scope.organizationId.toLowerCase() === body.scope.organizationId.toLowerCase(),
      );
    const candidate =
      directCandidate ?? (inheritedFromOrganization ? { scope: body.scope } : undefined);
    if (!candidate) {
      throw new DomainError('FORBIDDEN', 'به این مجموعه یا شعبه دسترسی فعال ندارید.');
    }

    const option = await this.resolveActiveScope(candidate.scope);
    if (!option) {
      throw new DomainError(
        'FORBIDDEN',
        'مجموعه یا شعبه‌ی انتخاب‌شده فعال نیست یا دیگر در دسترس شما نیست.',
      );
    }

    await this.auth.recordOperationsScopeSelection(user.id, candidate.scope, correlationId);
    return success({ ...option, policyVersion: context.policyVersion }, request);
  }

  private candidates(context: OperationsAccessContext): ScopeCandidate[] {
    const unique = new Map<string, ScopeCandidate>();
    for (const membership of context.memberships) {
      if (membership.status !== 'active' || membership.role.status !== 'active') continue;
      const scope = membership.scope;
      if (scope.type === 'global') continue;
      const candidate: ScopeCandidate = { scope };
      unique.set(scopeKey(scope), candidate);
    }
    return [...unique.values()];
  }

  private async listOrganizationScopeOptions(
    scope: Extract<TenantScope, { type: 'organization' }>,
  ): Promise<OperationsScopeOption[]> {
    let organization: Awaited<ReturnType<OrganizationBranchClient['getOrganization']>>;
    try {
      organization = await this.organizationBranch.getOrganization(scope.organizationId);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') return [];
      throw error;
    }
    if (organization.status !== 'active') return [];

    const options: OperationsScopeOption[] = [
      { scope, organization: { id: organization.id, name: organization.name } },
    ];
    const seenCursors = new Set<string>();
    const seenBranchIds = new Set<string>();
    let cursor: string | undefined;

    for (let pageNumber = 0; pageNumber < maxInheritedBranchPages; pageNumber += 1) {
      const page = await this.organizationBranch.listOrganizationBranches(scope.organizationId, {
        pageSize: inheritedBranchPageSize,
        ...(cursor ? { cursor } : {}),
      });

      for (const branch of page.items) {
        const branchId = branch.id.toLowerCase();
        if (
          seenBranchIds.has(branchId) ||
          branch.organizationId.toLowerCase() !== scope.organizationId.toLowerCase()
        ) {
          throw new DomainError(
            'DEPENDENCY_UNAVAILABLE',
            'فهرست شعب سازمان با قرارداد مالک داده سازگار نیست.',
          );
        }
        seenBranchIds.add(branchId);
        if (branch.status === 'active') {
          options.push({
            scope: { type: 'branch', organizationId: scope.organizationId, branchId: branch.id },
            organization: { id: organization.id, name: organization.name },
            branch: { id: branch.id, name: branch.name, city: branch.city },
          });
        }
      }

      const nextCursor = page.nextCursor;
      if (nextCursor === null) return options;
      const normalizedCursor = nextCursor.toLowerCase();
      const lastBranchId = page.items.at(-1)?.id.toLowerCase();
      if (
        page.items.length !== inheritedBranchPageSize ||
        lastBranchId !== normalizedCursor ||
        seenCursors.has(normalizedCursor) ||
        normalizedCursor === cursor?.toLowerCase()
      ) {
        throw new DomainError(
          'DEPENDENCY_UNAVAILABLE',
          'صفحه‌بندی فهرست شعب مالک داده معتبر نیست.',
        );
      }
      seenCursors.add(normalizedCursor);
      cursor = nextCursor;
    }

    throw new DomainError('DEPENDENCY_UNAVAILABLE', 'تعداد صفحه‌های فهرست شعب بیش از حد مجاز است.');
  }

  private async resolveActiveScope(scope: TenantScope): Promise<OperationsScopeOption | null> {
    if (scope.type === 'organization') {
      try {
        const organization = await this.organizationBranch.getOrganization(scope.organizationId);
        if (organization.status !== 'active') return null;
        return {
          scope,
          organization: { id: organization.id, name: organization.name },
        };
      } catch (error) {
        if (error instanceof DomainError && error.code === 'NOT_FOUND') return null;
        throw error;
      }
    }

    try {
      const [organization, branch] = await Promise.all([
        this.organizationBranch.getOrganization(scope.organizationId),
        this.organizationBranch.getOrganizationBranch(scope.organizationId, scope.branchId),
      ]);
      if (
        organization.status !== 'active' ||
        branch.status !== 'active' ||
        branch.organizationId.toLowerCase() !== scope.organizationId.toLowerCase()
      ) {
        return null;
      }
      return {
        scope,
        organization: { id: organization.id, name: organization.name },
        branch: { id: branch.id, name: branch.name, city: branch.city },
      };
    } catch (error) {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') return null;
      throw error;
    }
  }
}

function scopeKey(scope: AccessScopeDto): string {
  if (scope.type === 'global') return 'global';
  if (scope.type === 'organization') return `organization:${scope.organizationId.toLowerCase()}`;
  return `branch:${scope.organizationId.toLowerCase()}:${scope.branchId.toLowerCase()}`;
}

function sameScope(left: TenantScope, right: TenantScope): boolean {
  return scopeKey(left) === scopeKey(right);
}
