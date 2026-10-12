import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import {
  IdentityAccessClient,
  type AccessScopeDto,
} from '../../infrastructure/identity-access/identity-access.client.js';
import {
  OrganizationBranchClient,
  type OrganizationBranchCommandMeta,
} from '../../infrastructure/organization-branch/organization-branch.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const pageQuerySchema = z
  .object({
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const reason = z.string().trim().min(8).max(500).optional();
const organizationCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    timezone: z.string().trim().min(1).max(64),
    reason,
  })
  .strict();
const organizationUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    reason,
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.slug !== undefined || value.timezone !== undefined,
  );
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const openingHours = z.record(
  z.enum(['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  z.object({ open: time, close: time }).strict().nullable(),
);
const branchCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    address: z.string().trim().min(3).max(500),
    city: z.string().trim().min(2).max(120),
    timezone: z.string().trim().min(1).max(64),
    openingHours,
    reason,
  })
  .strict();
const branchUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    address: z.string().trim().min(3).max(500).optional(),
    city: z.string().trim().min(2).max(120).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    openingHours: openingHours.optional(),
    reason,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.slug !== undefined ||
      value.address !== undefined ||
      value.city !== undefined ||
      value.timezone !== undefined ||
      value.openingHours !== undefined,
  );
const statusSchema = z.object({ status: z.enum(['active', 'suspended']), reason }).strict();
type PageQuery = z.infer<typeof pageQuerySchema>;

const scopedOrganizationBatchSize = 10;

@Controller('api/v1/system/organizations')
@UseGuards(SessionGuard)
export class SystemOrganizationController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly organizationBranch: OrganizationBranchClient,
  ) {}

  @Get()
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async listOrganizations(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const session = this.session(request);
    const globalRead = await this.identityAccess.evaluateAuthorization(
      user.id,
      session,
      { permission: 'organization.read', scope: { type: 'global' } },
      correlationId,
    );
    if (globalRead.allowed) {
      const page = await this.organizationBranch.listOrganizations(query);
      return success(
        { items: page.items.map(presentOrganization), nextCursor: page.nextCursor },
        request,
      );
    }

    // Organization-scoped users receive only the organizations they can read.
    // Owner data is fetched by opaque IDs derived from IAM memberships, never by
    // trusting a client-supplied list of tenant IDs.
    const context = await this.identityAccess.currentAccessContext(user.id, correlationId);
    const candidateIds = [
      ...new Set(
        context.memberships
          .filter(
            (membership) =>
              membership.status === 'active' && membership.scope.type === 'organization',
          )
          .map((membership) =>
            membership.scope.type === 'organization' ? membership.scope.organizationId : '',
          )
          .filter(Boolean),
      ),
    ]
      .filter((id) => !query.cursor || id.toLowerCase() > query.cursor.toLowerCase())
      .sort((left, right) => left.localeCompare(right));

    const items: Awaited<ReturnType<OrganizationBranchClient['getOrganization']>>[] = [];
    let index = 0;
    while (index < candidateIds.length && items.length < query.pageSize) {
      const batch = candidateIds.slice(index, index + scopedOrganizationBatchSize);
      const decisions = await Promise.all(
        batch.map((organizationId) =>
          this.identityAccess.evaluateAuthorization(
            user.id,
            session,
            {
              permission: 'organization.read',
              scope: { type: 'organization', organizationId },
              resource: { type: 'organization', id: organizationId },
            },
            correlationId,
          ),
        ),
      );
      const remaining = query.pageSize - items.length;
      const permittedIds = batch
        .filter((_, itemIndex) => decisions[itemIndex]?.allowed)
        .slice(0, remaining);
      const permittedOrganizations = await Promise.all(
        permittedIds.map(async (organizationId) => {
          try {
            return await this.organizationBranch.getOrganization(organizationId);
          } catch (error) {
            if (error instanceof DomainError && error.code === 'NOT_FOUND') return null;
            throw error;
          }
        }),
      );
      items.push(
        ...permittedOrganizations.filter((item): item is NonNullable<typeof item> => item !== null),
      );
      index += batch.length;

      if (items.length >= query.pageSize) {
        const lastId = items.at(-1)?.id;
        const hasMoreCandidates = Boolean(
          lastId && candidateIds.some((id) => id.toLowerCase() > lastId.toLowerCase()),
        );
        return success(
          {
            items: items.slice(0, query.pageSize).map(presentOrganization),
            nextCursor: hasMoreCandidates ? lastId! : null,
          },
          request,
        );
      }
    }

    return success({ items: items.map(presentOrganization), nextCursor: null }, request);
  }

  @Post()
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  async createOrganization(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(organizationCreateSchema))
    body: z.infer<typeof organizationCreateSchema>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      this.session(request),
      'organization.create',
      { type: 'global' },
      undefined,
      correlationId,
    );
    return success(
      presentOrganization(
        await this.organizationBranch.createOrganization(
          body,
          this.commandMeta(user.id, correlationId, idempotencyKey),
        ),
      ),
      request,
    );
  }

  @Get(':organizationId')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async getOrganization(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.uuid(rawOrganizationId, 'شناسه‌ی مجموعه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      this.session(request),
      'organization.read',
      this.organizationScope(organizationId),
      { type: 'organization', id: organizationId },
      correlationId,
    );
    return success(
      presentOrganization(await this.organizationBranch.getOrganization(organizationId)),
      request,
    );
  }

  @Patch(':organizationId')
  @UseGuards(TrustedOriginGuard)
  async updateOrganization(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(organizationUpdateSchema))
    body: z.infer<typeof organizationUpdateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.uuid(rawOrganizationId, 'شناسه‌ی مجموعه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      this.session(request),
      'organization.update',
      this.organizationScope(organizationId),
      { type: 'organization', id: organizationId },
      correlationId,
    );
    return success(
      presentOrganization(
        await this.organizationBranch.updateOrganization(
          organizationId,
          this.expectedVersion(ifMatch),
          body,
          this.commandMeta(user.id, correlationId, idempotencyKey),
        ),
      ),
      request,
    );
  }

  @Post(':organizationId/status')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async changeOrganizationStatus(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.uuid(rawOrganizationId, 'شناسه‌ی مجموعه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      this.session(request),
      'organization.update',
      this.organizationScope(organizationId),
      { type: 'organization', id: organizationId },
      correlationId,
    );
    return success(
      presentOrganization(
        await this.organizationBranch.changeOrganizationStatus(
          organizationId,
          this.expectedVersion(ifMatch),
          body,
          this.commandMeta(user.id, correlationId, idempotencyKey),
        ),
      ),
      request,
    );
  }

  @Get(':organizationId/branches')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async listBranches(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.uuid(rawOrganizationId, 'شناسه‌ی مجموعه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      this.session(request),
      'branch.read',
      this.organizationScope(organizationId),
      { type: 'organization', id: organizationId },
      correlationId,
    );
    const page = await this.organizationBranch.listOrganizationBranches(organizationId, query);
    return success({ items: page.items.map(presentBranch), nextCursor: page.nextCursor }, request);
  }

  @Post(':organizationId/branches')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  async createBranch(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(branchCreateSchema)) body: z.infer<typeof branchCreateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.uuid(rawOrganizationId, 'شناسه‌ی مجموعه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      this.session(request),
      'branch.create',
      this.organizationScope(organizationId),
      { type: 'organization', id: organizationId },
      correlationId,
    );
    return success(
      presentBranch(
        await this.organizationBranch.createBranch(
          organizationId,
          body,
          this.commandMeta(user.id, correlationId, idempotencyKey),
        ),
      ),
      request,
    );
  }

  @Get(':organizationId/branches/:branchId')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async getBranch(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.uuid(rawOrganizationId, 'شناسه‌ی مجموعه معتبر نیست.');
    const branchId = this.uuid(rawBranchId, 'شناسه‌ی شعبه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      this.session(request),
      'branch.read',
      this.branchScope(organizationId, branchId),
      { type: 'branch', id: branchId },
      correlationId,
    );
    return success(
      presentBranch(await this.organizationBranch.getOrganizationBranch(organizationId, branchId)),
      request,
    );
  }

  @Patch(':organizationId/branches/:branchId')
  @UseGuards(TrustedOriginGuard)
  async updateBranch(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(branchUpdateSchema)) body: z.infer<typeof branchUpdateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.uuid(rawOrganizationId, 'شناسه‌ی مجموعه معتبر نیست.');
    const branchId = this.uuid(rawBranchId, 'شناسه‌ی شعبه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      this.session(request),
      'branch.update',
      this.branchScope(organizationId, branchId),
      { type: 'branch', id: branchId },
      correlationId,
    );
    return success(
      presentBranch(
        await this.organizationBranch.updateBranch(
          organizationId,
          branchId,
          this.expectedVersion(ifMatch),
          body,
          this.commandMeta(user.id, correlationId, idempotencyKey),
        ),
      ),
      request,
    );
  }

  @Post(':organizationId/branches/:branchId/status')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async changeBranchStatus(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.uuid(rawOrganizationId, 'شناسه‌ی مجموعه معتبر نیست.');
    const branchId = this.uuid(rawBranchId, 'شناسه‌ی شعبه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const permission = body.status === 'suspended' ? 'branch.deactivate' : 'branch.update';
    await this.authorize(
      user.id,
      this.session(request),
      permission,
      this.branchScope(organizationId, branchId),
      { type: 'branch', id: branchId },
      correlationId,
    );
    return success(
      presentBranch(
        await this.organizationBranch.changeBranchStatus(
          organizationId,
          branchId,
          this.expectedVersion(ifMatch),
          body,
          this.commandMeta(user.id, correlationId, idempotencyKey),
        ),
      ),
      request,
    );
  }

  private async authorize(
    userId: string,
    session: NonNullable<AuthenticatedRequest['session']>,
    permission: string,
    scope: AccessScopeDto,
    resource: { type: string; id: string } | undefined,
    correlationId: string,
  ) {
    const decision = await this.identityAccess.evaluateAuthorization(
      userId,
      session,
      { permission, scope, ...(resource ? { resource } : {}) },
      correlationId,
    );
    if (!decision.allowed) {
      throw new DomainError(
        'FORBIDDEN',
        'مجوز لازم یا تأیید دومرحله‌ای تازه برای این عملیات وجود ندارد.',
      );
    }
  }

  private session(request: AuthenticatedRequest) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    return request.session;
  }

  private commandMeta(
    actorUserId: string,
    correlationId: string,
    idempotencyKey: string | undefined,
  ): OrganizationBranchCommandMeta {
    const parsedKey = uuid.safeParse(idempotencyKey);
    if (!parsedKey.success)
      throw new BadRequestException('A valid UUID Idempotency-Key is required.');
    return { actorUserId, correlationId, idempotencyKey: parsedKey.data };
  }

  private expectedVersion(value: string | undefined): number {
    const match = /^"([1-9][0-9]*)"$/.exec(value ?? '');
    const version = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(version))
      throw new BadRequestException('A quoted If-Match version is required.');
    return version;
  }

  private uuid(value: string, message: string): string {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) throw new BadRequestException(message);
    return parsed.data;
  }

  private organizationScope(organizationId: string): AccessScopeDto {
    return { type: 'organization', organizationId };
  }

  private branchScope(organizationId: string, branchId: string): AccessScopeDto {
    return { type: 'branch', organizationId, branchId };
  }
}

function presentOrganization(
  organization: Awaited<ReturnType<OrganizationBranchClient['getOrganization']>>,
) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    timezone: organization.timezone,
    status: organization.status,
    version: organization.version,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

function presentBranch(
  branch: Awaited<ReturnType<OrganizationBranchClient['getOrganizationBranch']>>,
) {
  return {
    id: branch.id,
    organizationId: branch.organizationId,
    name: branch.name,
    slug: branch.slug,
    address: branch.address,
    city: branch.city,
    timezone: branch.timezone,
    status: branch.status,
    openingHours: branch.openingHours,
    version: branch.version,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}
