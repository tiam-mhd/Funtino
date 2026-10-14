import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import {
  WalletClient,
  type WalletManualCardStatus,
  type WalletCommandMeta,
} from '../../infrastructure/wallet/wallet.client.js';
import {
  IdentityAccessClient,
  type AccessScopeDto,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { CustomerHouseholdClient } from '../../infrastructure/customer-household/customer-household.client.js';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import { normalizePhone } from '../../application/auth/auth.service.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const reason = z.string().trim().min(8).max(500);
const optionalReason = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => value || undefined);
const cardIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const pageSchema = z
  .object({
    status: z.enum(['in_stock', 'assigned', 'blocked', 'retired']).optional(),
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const registrationSchema = z
  .object({ externalCardId: cardIdentifier, reason: optionalReason })
  .strict();
const statusSchema = z
  .object({ status: z.enum(['in_stock', 'blocked', 'retired']), reason: optionalReason })
  .strict();
const phoneSchema = z.string().trim().min(8).max(20);
const householdLookupSchema = z.object({ phone: phoneSchema }).strict();
const assignmentSchema = z.object({ phone: phoneSchema, householdId: uuid, reason }).strict();
const cancellationSchema = z.object({ reason }).strict();
const assignmentPageSchema = z
  .object({
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const customerLookupWindowMs = 15 * 60 * 1000;
const customerLookupMaxRequests = 30;

type CardPageQuery = z.infer<typeof pageSchema>;

@Controller('api/v1/operations')
@UseGuards(SessionGuard)
export class OperationsCardsController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly wallet: WalletClient,
    private readonly households: CustomerHouseholdClient,
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
  ) {}

  @Get('organizations/:organizationId/branches/:branchId/cards')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async listCards(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Query(new ZodValidationPipe(pageSchema)) query: CardPageQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'card.inventory.read',
      scope,
      { type: 'branch', id: branchId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);

    const [page, canManage, canAssign, canTransfer, canUnassign, canLookupCustomer] =
      await Promise.all([
        this.wallet.listCards({ organizationId, branchId, ...query }),
        this.capability(user.id, request, 'card.inventory.manage', scope, undefined, correlationId),
        this.capability(user.id, request, 'card.assign', scope, undefined, correlationId),
        this.capability(user.id, request, 'card.transfer', scope, undefined, correlationId),
        this.capability(user.id, request, 'card.unassign', scope, undefined, correlationId),
        this.capability(
          user.id,
          request,
          'customer.lookup.limited',
          scope,
          undefined,
          correlationId,
        ),
      ]);
    return {
      ...success(
        {
          items: page.items,
          capabilities: {
            canManage,
            canAssign,
            canTransfer,
            canUnassign,
            canLookupCustomer,
          },
        },
        request,
      ),
      nextCursor: page.nextCursor,
    };
  }

  @Post('organizations/:organizationId/branches/:branchId/cards')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  async registerCard(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(registrationSchema)) body: z.infer<typeof registrationSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'card.inventory.manage',
      scope,
      { type: 'branch', id: branchId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    return success(
      await this.wallet.registerCard(
        organizationId,
        branchId,
        body,
        this.commandMeta(user.id, correlationId, idempotencyKey),
      ),
      request,
    );
  }

  @Patch('organizations/:organizationId/branches/:branchId/cards/:cardId')
  @UseGuards(TrustedOriginGuard)
  async changeCardStatus(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Param('cardId') rawCardId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const cardId = this.parseUuid(rawCardId, 'شناسه کارت معتبر نیست.');
    const version = this.parseVersion(ifMatch);
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'card.inventory.manage',
      scope,
      { type: 'card', id: cardId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    return success(
      await this.wallet.changeCardStatus(
        organizationId,
        branchId,
        cardId,
        version,
        { status: body.status as WalletManualCardStatus, reason: body.reason },
        this.commandMeta(user.id, correlationId, idempotencyKey),
      ),
      request,
    );
  }

  @Get('organizations/:organizationId/branches/:branchId/card-assignments')
  @Header('cache-control', 'no-store, private')
  async listAssignments(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Query(new ZodValidationPipe(assignmentPageSchema)) query: z.infer<typeof assignmentPageSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'card.inventory.read',
      scope,
      { type: 'branch', id: branchId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    const page = await this.wallet.listBranchAssignments({ organizationId, branchId, ...query });
    return { ...success({ items: page.items }, request), nextCursor: page.nextCursor };
  }

  @Post('organizations/:organizationId/branches/:branchId/customer-households/lookup')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'no-store, private')
  async lookupHouseholds(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Body(new ZodValidationPipe(householdLookupSchema))
    query: z.infer<typeof householdLookupSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'customer.lookup.limited',
      scope,
      { type: 'branch', id: branchId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    const now = Date.now();
    const windowStartedAt = Math.floor(now / customerLookupWindowMs) * customerLookupWindowMs;
    const lookupCount = await this.store.consumeOperationsCustomerLookupQuota({
      actorUserId: user.id,
      branchId,
      windowStartedAt,
      maxRequests: customerLookupMaxRequests,
    });
    if (lookupCount > customerLookupMaxRequests) {
      if (lookupCount === customerLookupMaxRequests + 1) {
        await this.store.recordAudit(
          user.id,
          'operations.customer.household_lookup_rate_limited',
          'branch',
          branchId,
          correlationId,
          'fixed_window_limit_exceeded',
          scope,
        );
      }
      throw new HttpException(
        'تعداد جست‌وجوی مشتری در این شعبه از حد مجاز گذشت؛ کمی بعد دوباره تلاش کنید.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const households = await this.resolveHouseholdsByPhone(
      query.phone,
      user.id,
      correlationId,
      scope,
    );
    const maskedPhone = maskPhone(normalizePhone(query.phone));
    return success(
      {
        items: households.map(({ id, name, members }) => ({
          householdId: id,
          householdName: name,
          maskedPhone,
          activeMemberCount: members.filter((member) => member.status === 'active').length,
        })),
      },
      request,
    );
  }

  @Post('organizations/:organizationId/branches/:branchId/cards/:cardId/assignments')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  async assignCard(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Param('cardId') rawCardId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(assignmentSchema)) body: z.infer<typeof assignmentSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const cardId = this.parseUuid(rawCardId, 'شناسه کارت معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'card.assign',
      scope,
      { type: 'card', id: cardId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    await this.requireHouseholdForPhone(
      body.phone,
      body.householdId,
      user.id,
      correlationId,
      scope,
    );
    return success(
      await this.wallet.assignCard(
        organizationId,
        branchId,
        cardId,
        { householdId: body.householdId, reason: body.reason },
        this.commandMeta(user.id, correlationId, idempotencyKey),
      ),
      request,
    );
  }

  @Post('organizations/:organizationId/branches/:branchId/card-assignments/:assignmentId/transfer')
  @UseGuards(TrustedOriginGuard)
  async transferAssignment(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Param('assignmentId') rawAssignmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(assignmentSchema)) body: z.infer<typeof assignmentSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const assignmentId = this.parseUuid(rawAssignmentId, 'شناسه تخصیص معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'card.transfer',
      scope,
      { type: 'card_assignment', id: assignmentId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    await this.requireHouseholdForPhone(
      body.phone,
      body.householdId,
      user.id,
      correlationId,
      scope,
    );
    return success(
      await this.wallet.transferAssignment(
        organizationId,
        branchId,
        assignmentId,
        { householdId: body.householdId, reason: body.reason },
        this.commandMeta(user.id, correlationId, idempotencyKey),
      ),
      request,
    );
  }

  @Post('organizations/:organizationId/branches/:branchId/card-assignments/:assignmentId/cancel')
  @UseGuards(TrustedOriginGuard)
  async cancelAssignment(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Param('assignmentId') rawAssignmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(cancellationSchema)) body: z.infer<typeof cancellationSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const assignmentId = this.parseUuid(rawAssignmentId, 'شناسه تخصیص معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'card.unassign',
      scope,
      { type: 'card_assignment', id: assignmentId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    return success(
      await this.wallet.cancelAssignment(
        organizationId,
        branchId,
        assignmentId,
        body,
        this.commandMeta(user.id, correlationId, idempotencyKey),
      ),
      request,
    );
  }

  private async resolveHouseholdsByPhone(
    rawPhone: string,
    actorUserId: string,
    correlationId: string,
    scope: { organizationId: string; branchId: string },
  ) {
    // Record a branch-scoped attempt before touching the customer identity/household owners.
    // The raw phone is intentionally absent from audit resource IDs, reasons, and metadata.
    await this.store.recordAudit(
      actorUserId,
      'operations.customer.household_lookup',
      'customer_lookup',
      randomUUID(),
      correlationId,
      null,
      scope,
    );
    let phoneE164: string;
    try {
      phoneE164 = normalizePhone(rawPhone);
    } catch {
      throw new BadRequestException('شماره تلفن معتبر نیست.');
    }
    const user = await this.store.getUserByPhone(phoneE164);
    if (!user) return [];
    await this.store.recordAudit(
      actorUserId,
      'operations.customer.household_lookup',
      'customer_user',
      user.id,
      correlationId,
      null,
      scope,
    );
    const households = await this.households.listHouseholdsForUser(user.id);
    return households.filter((household) => household.status === 'active');
  }

  private async requireHouseholdForPhone(
    phone: string,
    householdId: string,
    actorUserId: string,
    correlationId: string,
    scope: { organizationId: string; branchId: string },
  ) {
    const households = await this.resolveHouseholdsByPhone(
      phone,
      actorUserId,
      correlationId,
      scope,
    );
    const household = households.find(
      (item) => item.id.toLowerCase() === householdId.toLowerCase(),
    );
    if (!household)
      throw new DomainError('FORBIDDEN', 'خانواده‌ی انتخاب‌شده با شماره‌ی تأییدشده تطبیق ندارد.');
    return household;
  }

  private async assertActiveScope(organizationId: string, branchId: string) {
    const organization = await this.organizationBranch.getOrganization(organizationId);
    if (organization.status !== 'active') throw new DomainError('CONFLICT', 'مجموعه فعال نیست.');
    const branch = await this.organizationBranch.getOrganizationBranch(organizationId, branchId);
    if (branch.organizationId.toLowerCase() !== organizationId.toLowerCase()) {
      throw new DomainError('NOT_FOUND', 'شعبه در این مجموعه پیدا نشد.');
    }
    if (branch.status !== 'active') throw new DomainError('CONFLICT', 'شعبه فعال نیست.');
  }

  private async authorize(
    userId: string,
    request: AuthenticatedRequest,
    permission: string,
    scope: AccessScopeDto,
    resource: { type: string; id: string },
    correlationId: string,
  ) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    const result = await this.identityAccess.evaluateAuthorization(
      userId,
      request.session,
      { permission, scope, resource },
      correlationId,
    );
    if (!result.allowed)
      throw new DomainError('FORBIDDEN', 'مجوز لازم برای این عملیات یا محدوده را ندارید.');
  }

  private async allowed(
    userId: string,
    request: AuthenticatedRequest,
    permission: string,
    scope: AccessScopeDto,
    resource: { type: string; id: string } | undefined,
    correlationId: string,
  ) {
    if (!request.session) return false;
    const result = await this.identityAccess.evaluateAuthorization(
      userId,
      request.session,
      { permission, scope, ...(resource ? { resource } : {}) },
      correlationId,
    );
    return result.allowed;
  }

  private async capability(
    userId: string,
    request: AuthenticatedRequest,
    permission: string,
    scope: AccessScopeDto,
    resource: { type: string; id: string } | undefined,
    correlationId: string,
  ): Promise<boolean> {
    if (!request.session) return false;
    const result = await this.identityAccess.evaluateAuthorization(
      userId,
      request.session,
      { permission, scope, ...(resource ? { resource } : {}) },
      correlationId,
    );
    return result.allowed;
  }

  private commandMeta(
    userId: string,
    correlationId: string,
    idempotencyKey?: string,
  ): WalletCommandMeta {
    if (!idempotencyKey || !uuid.safeParse(idempotencyKey).success) {
      throw new BadRequestException('A valid UUID Idempotency-Key is required.');
    }
    return { actorUserId: userId, correlationId, idempotencyKey };
  }

  private parseUuid(value: string, message: string) {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) throw new BadRequestException(message);
    return parsed.data;
  }

  private parseVersion(value?: string) {
    const match = /^"([1-9]\d*)"$/.exec(value ?? '');
    if (!match) throw new BadRequestException('A quoted If-Match version is required.');
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version))
      throw new BadRequestException('If-Match version is invalid.');
    return version;
  }
}

function maskPhone(phoneE164: string): string {
  return `••••••${phoneE164.slice(-4)}`;
}
