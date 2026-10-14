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
  DeviceIntegrationClient,
  type DeviceCommandMeta,
} from '../../infrastructure/device-integration/device-integration.client.js';
import {
  IdentityAccessClient,
  type AccessScopeDto,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const pageSchema = z
  .object({
    scopeType: z.enum(['organization', 'branch']),
    organizationId: uuid,
    branchId: uuid.optional(),
    status: z.enum(['active', 'suspended', 'retired']).optional(),
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeType === 'branch' && !value.branchId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Branch scope requires a branch identifier.',
      });
    }
    if (value.scopeType === 'organization' && value.branchId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Organization scope cannot include a branch identifier.',
      });
    }
  });
const pageQuerySchema = z
  .object({
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
const reason = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => value || undefined);
const registrationSchema = z
  .object({
    adapterKey: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    externalDeviceId: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(120),
    deviceType: z.enum(['rfid_reader', 'terminal', 'access_gate', 'other']),
    reason,
  })
  .strict();
const updateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['active', 'suspended', 'retired']).optional(),
    reason,
  })
  .strict()
  .refine((value) => value.displayName !== undefined || value.status !== undefined);

type DevicePageQuery = z.infer<typeof pageSchema>;

@Controller('api/v1/operations')
@UseGuards(SessionGuard)
export class OperationsDevicesController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly devices: DeviceIntegrationClient,
  ) {}

  @Get('devices')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async listDevices(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(pageSchema)) query: DevicePageQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const scope = this.scopeFromQuery(query);
    await this.authorize(user.id, request, 'device.health.read', scope, undefined, correlationId);
    await this.assertActiveScope(query.organizationId, query.branchId);
    const [page, canRegister, canManage, canReadBranches] = await Promise.all([
      this.devices.listDevices({
        organizationId: query.organizationId,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        pageSize: query.pageSize,
      }),
      this.allowed(user.id, request, 'device.register', scope, undefined, correlationId),
      this.allowed(user.id, request, 'device.maintenance.manage', scope, undefined, correlationId),
      scope.type === 'organization'
        ? this.allowed(user.id, request, 'branch.read', scope, undefined, correlationId)
        : Promise.resolve(true),
    ]);
    return {
      ...success(
        { items: page.items, capabilities: { canRegister, canManage, canReadBranches } },
        request,
      ),
      nextCursor: page.nextCursor,
    };
  }

  @Get('organizations/:organizationId/branches')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async listBranches(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: z.infer<typeof pageQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'organization', organizationId };
    await this.authorize(
      user.id,
      request,
      'branch.read',
      scope,
      { type: 'organization', id: organizationId },
      correlationId,
    );
    const organization = await this.organizationBranch.getOrganization(organizationId);
    if (organization.status !== 'active') throw new DomainError('CONFLICT', 'مجموعه فعال نیست.');
    const page = await this.organizationBranch.listOrganizationBranches(organizationId, query);
    const items = page.items
      .filter((branch) => branch.status === 'active')
      .map((branch) => ({
        id: branch.id,
        organizationId: branch.organizationId,
        name: branch.name,
        city: branch.city,
      }));
    return { ...success({ items }, request), nextCursor: page.nextCursor };
  }

  @Post('organizations/:organizationId/branches/:branchId/devices')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  async registerDevice(
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
      'device.register',
      scope,
      { type: 'branch', id: branchId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    return success(
      await this.devices.registerDevice(
        organizationId,
        branchId,
        body,
        this.commandMeta(user.id, correlationId, idempotencyKey),
      ),
      request,
    );
  }

  @Patch('organizations/:organizationId/branches/:branchId/devices/:deviceId')
  @UseGuards(TrustedOriginGuard)
  async updateDevice(
    @CurrentUser() user: { id: string },
    @Param('organizationId') rawOrganizationId: string,
    @Param('branchId') rawBranchId: string,
    @Param('deviceId') rawDeviceId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const organizationId = this.parseUuid(rawOrganizationId, 'شناسه مجموعه معتبر نیست.');
    const branchId = this.parseUuid(rawBranchId, 'شناسه شعبه معتبر نیست.');
    const deviceId = this.parseUuid(rawDeviceId, 'شناسه دستگاه معتبر نیست.');
    const version = this.parseVersion(ifMatch);
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = { type: 'branch', organizationId, branchId };
    await this.authorize(
      user.id,
      request,
      'device.maintenance.manage',
      scope,
      { type: 'device', id: deviceId },
      correlationId,
    );
    await this.assertActiveScope(organizationId, branchId);
    return success(
      await this.devices.updateDevice(
        organizationId,
        branchId,
        deviceId,
        version,
        body,
        this.commandMeta(user.id, correlationId, idempotencyKey),
      ),
      request,
    );
  }

  private scopeFromQuery(query: DevicePageQuery): AccessScopeDto {
    return query.scopeType === 'organization'
      ? { type: 'organization', organizationId: query.organizationId }
      : { type: 'branch', organizationId: query.organizationId, branchId: query.branchId! };
  }

  private async assertActiveScope(organizationId: string, branchId?: string) {
    const organization = await this.organizationBranch.getOrganization(organizationId);
    if (organization.status !== 'active') throw new DomainError('CONFLICT', 'مجموعه فعال نیست.');
    if (branchId) {
      const branch = await this.organizationBranch.getOrganizationBranch(organizationId, branchId);
      if (branch.organizationId.toLowerCase() !== organizationId.toLowerCase()) {
        throw new DomainError('NOT_FOUND', 'شعبه در این مجموعه پیدا نشد.');
      }
      if (branch.status !== 'active') throw new DomainError('CONFLICT', 'شعبه فعال نیست.');
    }
  }

  private async authorize(
    userId: string,
    request: AuthenticatedRequest,
    permission: string,
    scope: AccessScopeDto,
    resource: { type: string; id: string } | undefined,
    correlationId: string,
  ) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    const result = await this.identityAccess.evaluateAuthorization(
      userId,
      request.session,
      { permission, scope, ...(resource ? { resource } : {}) },
      correlationId,
    );
    if (!result.allowed)
      throw new DomainError('FORBIDDEN', 'مجوز لازم برای این عملیات یا محدوده را ندارید.');
    return true;
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

  private commandMeta(
    userId: string,
    correlationId: string,
    idempotencyKey?: string,
  ): DeviceCommandMeta {
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
