import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import { formDefinitionSchema, formThemeSchema } from '@funtino/forms-schema';
import { FormsClient } from '../../infrastructure/forms/forms.client.js';
import { IdentityAccessClient } from '../../infrastructure/identity-access/identity-access.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';
import { NoStoreInterceptor } from './no-store.interceptor.js';

const uuid = z.string().uuid();
const querySchema = z.object({
  organizationId: uuid.optional(),
  branchId: uuid.optional(),
  status: z.enum(['draft', 'published', 'paused', 'archived']).optional(),
  query: z.string().trim().max(120).optional(),
  cursor: uuid.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  definition: formDefinitionSchema,
}).strict();
const templateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  definition: formDefinitionSchema.optional(),
  enabled: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.description !== undefined || value.definition !== undefined || value.enabled !== undefined);
const settingsSchema = z.object({ defaultTheme: formThemeSchema }).strict();

@Controller('api/v1/system/forms')
@UseGuards(SessionGuard)
@UseInterceptors(NoStoreInterceptor)
export class SystemFormsController {
  constructor(private readonly identityAccess: IdentityAccessClient, private readonly forms: FormsClient) {}

  @Get()
  async list(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(querySchema)) query: z.infer<typeof querySchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.platform.read', correlationId);
    return success(await this.forms.request('/internal/v1/system/forms', { query, correlationId }), request);
  }

  @Get('templates')
  async listTemplates(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.platform.read', correlationId);
    return success(await this.forms.request('/internal/v1/system/forms/templates', { correlationId }), request);
  }

  @Post('templates')
  @UseGuards(TrustedOriginGuard)
  async createTemplate(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(templateCreateSchema)) body: z.infer<typeof templateCreateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.platform.manage', correlationId);
    return success(await this.forms.request('/internal/v1/system/forms/templates', {
      method: 'POST', body: { ...body, scopeType: 'global', actorUserId: user.id, correlationId }, actorUserId: user.id, correlationId,
    }), request);
  }

  @Patch('templates/:templateId')
  @UseGuards(TrustedOriginGuard)
  async updateTemplate(
    @CurrentUser() user: { id: string },
    @Param('templateId') rawTemplateId: string,
    @Body(new ZodValidationPipe(templateUpdateSchema)) body: z.infer<typeof templateUpdateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const templateId = this.parseUuid(rawTemplateId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.platform.manage', correlationId);
    return success(await this.forms.request(`/internal/v1/system/forms/templates/${templateId}`, {
      method: 'PATCH', body: { ...body, actorUserId: user.id, correlationId }, actorUserId: user.id, correlationId,
    }), request);
  }

  @Get('settings')
  async settings(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.platform.read', correlationId);
    return success(await this.forms.request('/internal/v1/system/forms/settings', { correlationId }), request);
  }

  @Put('settings')
  @UseGuards(TrustedOriginGuard)
  async updateSettings(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.platform.manage', correlationId);
    return success(await this.forms.request('/internal/v1/system/forms/settings', {
      method: 'PUT', body: { ...body, actorUserId: user.id, correlationId }, actorUserId: user.id, correlationId,
    }), request);
  }

  private async authorize(userId: string, request: AuthenticatedRequest, permission: string, correlationId: string) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'Session is invalid.');
    const decision = await this.identityAccess.evaluateAuthorization(
      userId,
      request.session,
      { permission, scope: { type: 'global' } },
      correlationId,
    );
    if (!decision.allowed) {
      const reason = decision.reason === 'step_up_required' ? 'MFA step-up is required for this operation.' : 'System forms permission is required.';
      throw new DomainError('FORBIDDEN', reason);
    }
  }

  private parseUuid(value: string) {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Template identifier is invalid.');
    return parsed.data;
  }
}
