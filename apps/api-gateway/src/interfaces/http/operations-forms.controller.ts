import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import { formDefinitionSchema } from '@funtino/forms-schema';
import {
  IdentityAccessClient,
  type AccessScopeDto,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { FormsClient } from '../../infrastructure/forms/forms.client.js';
import { OrganizationBranchClient } from '../../infrastructure/organization-branch/organization-branch.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';
import { NoStoreInterceptor } from './no-store.interceptor.js';

const uuid = z.string().uuid();
const responseStatuses = ['new', 'in_review', 'followed_up', 'closed', 'spam'] as const;
const formStatuses = ['draft', 'published', 'paused', 'archived'] as const;
const scopeQueryBaseSchema = z
  .object({
    scopeType: z.enum(['organization', 'branch']),
    organizationId: uuid,
    branchId: uuid.optional(),
  })
  .strict();
const validateScopeQuery = (
  value: z.infer<typeof scopeQueryBaseSchema>,
  context: z.RefinementCtx,
) => {
  if ((value.scopeType === 'branch') !== Boolean(value.branchId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Form scope is invalid.' });
  }
};
const scopeQuerySchema = scopeQueryBaseSchema.superRefine(validateScopeQuery);
const listSchema = scopeQueryBaseSchema
  .extend({
    status: z.enum(formStatuses).optional(),
    query: z.string().trim().max(120).optional(),
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .superRefine(validateScopeQuery);
const responseListSchema = scopeQueryBaseSchema
  .extend({
    status: z.enum(responseStatuses).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    searchFieldId: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .superRefine((value, context) => {
    validateScopeQuery(value, context);
    if (value.from && value.to && Date.parse(value.to) < Date.parse(value.from)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Response date range is invalid.' });
    }
  });
const exportSchema = scopeQueryBaseSchema
  .extend({
    status: z.enum(responseStatuses).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    includeSensitive: z.coerce.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    validateScopeQuery(value, context);
    if (value.from && value.to && Date.parse(value.to) < Date.parse(value.from)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Response date range is invalid.' });
    }
  });
const scopeBodySchema = z.object({ organizationId: uuid, branchId: uuid.optional() }).strict();
const createSchema = scopeBodySchema
  .extend({
    branchId: uuid,
    title: z.string().trim().min(1).max(160),
  })
  .strict();
const draftSchema = scopeBodySchema.extend({ definition: formDefinitionSchema }).strict();
const settingsSchema = scopeBodySchema
  .extend({
    accessMode: z.enum(['guest', 'optional_auth', 'auth_required']),
    linkEnabled: z.boolean(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    responseLimit: z.number().int().positive().nullable().optional(),
  })
  .strict();
const optionalReasonSchema = scopeBodySchema
  .extend({
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict();
const responseStatusSchema = scopeBodySchema
  .extend({
    status: z.enum(responseStatuses),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
  })
  .strict();
const jsonAnswerSchema = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()).max(100),
  z.record(z.unknown()),
]);
const responseCorrectionSchema = scopeBodySchema
  .extend({
    expectedVersion: z.number().int().nonnegative(),
    changes: z
      .array(z.object({ fieldId: uuid, value: jsonAnswerSchema }).strict())
      .min(1)
      .max(100),
    reason: z.string().trim().min(8).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.changes.map((change) => change.fieldId)).size !== value.changes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['changes'],
        message: 'A field may be corrected only once per request.',
      });
    }
  });
const noteSchema = scopeBodySchema.extend({ body: z.string().trim().min(1).max(2000) }).strict();
const tagsSchema = scopeBodySchema
  .extend({ tags: z.array(z.string().trim().min(1).max(40)).max(12) })
  .strict();
const templateListSchema = z
  .object({
    scopeType: z.enum(['organization', 'branch']).optional(),
    organizationId: uuid,
    branchId: uuid.optional(),
    enabledOnly: z.coerce.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeType && (value.scopeType === 'branch') !== Boolean(value.branchId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Template scope is invalid.' });
    }
  });
const templateCreateSchema = z
  .object({
    scopeType: z.enum(['organization', 'branch']),
    organizationId: uuid,
    branchId: uuid.optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    definition: formDefinitionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.scopeType === 'branch') !== Boolean(value.branchId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Template scope is invalid.' });
    }
  });
const templateUpdateSchema = z
  .object({
    organizationId: uuid,
    branchId: uuid.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    definition: formDefinitionSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.definition !== undefined ||
      value.enabled !== undefined,
  );

type ScopeQuery = z.infer<typeof scopeQuerySchema>;
type ScopeBody = z.infer<typeof scopeBodySchema>;

@Controller('api/v1/operations/forms')
@UseGuards(SessionGuard)
@UseInterceptors(NoStoreInterceptor)
export class OperationsFormsController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly organizationBranch: OrganizationBranchClient,
    private readonly forms: FormsClient,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const scope = this.accessScope(query);
    await this.authorize(user.id, request, 'forms.read', scope, correlationId);
    await this.assertActiveScope(query.organizationId, query.branchId);
    const page = await this.forms.request('/internal/v1/forms', {
      query: this.withoutScopeType(query),
      correlationId,
    });
    return success(page, request);
  }

  @Post()
  @UseGuards(TrustedOriginGuard)
  async create(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = {
      type: 'branch',
      organizationId: body.organizationId,
      branchId: body.branchId,
    };
    await this.authorize(user.id, request, 'forms.manage', scope, correlationId);
    await this.assertActiveScope(body.organizationId, body.branchId);
    const result = await this.forms.request('/internal/v1/forms', {
      method: 'POST',
      body: { ...body, actorUserId: user.id, correlationId },
      actorUserId: user.id,
      correlationId,
    });
    return success(result, request);
  }

  @Get('templates')
  async listTemplates(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(templateListSchema)) query: z.infer<typeof templateListSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto = query.branchId
      ? { type: 'branch', organizationId: query.organizationId, branchId: query.branchId! }
      : { type: 'organization', organizationId: query.organizationId };
    await this.authorize(user.id, request, 'forms.read', scope, correlationId);
    await this.assertActiveScope(query.organizationId, query.branchId);
    const { scopeType: _scopeType, ...scopeQuery } = query;
    return success(
      await this.forms.request('/internal/v1/forms/templates', {
        query: scopeQuery,
        correlationId,
      }),
      request,
    );
  }

  @Post('templates')
  @UseGuards(TrustedOriginGuard)
  async createTemplate(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(templateCreateSchema)) body: z.infer<typeof templateCreateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const scope: AccessScopeDto =
      body.scopeType === 'branch'
        ? { type: 'branch', organizationId: body.organizationId, branchId: body.branchId! }
        : { type: 'organization', organizationId: body.organizationId };
    await this.authorize(user.id, request, 'forms.templates.manage', scope, correlationId);
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request('/internal/v1/forms/templates', {
        method: 'POST',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Get('capabilities')
  async capabilities(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(scopeQuerySchema)) scope: ScopeQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const accessScope = this.accessScope(scope);
    await this.assertActiveScope(scope.organizationId, scope.branchId);
    const permissions = [
      'forms.read',
      'forms.manage',
      'forms.publish',
      'forms.responses.read',
      'forms.responses.manage',
      'forms.responses.correct',
      'forms.responses.pii.read',
      'forms.responses.export',
      'forms.templates.manage',
    ] as const;
    const decisions = await Promise.all(
      permissions.map(async (permission) => ({
        permission,
        result: await this.evaluate(user.id, request, permission, accessScope, correlationId),
      })),
    );
    const values = Object.fromEntries(
      decisions.map(({ permission, result }) => [permission, result]),
    );
    return success(
      {
        canRead: values['forms.read'].allowed,
        canManage: values['forms.manage'].allowed,
        canPublish: values['forms.publish'].allowed,
        canReadResponses: values['forms.responses.read'].allowed,
        canManageResponses: values['forms.responses.manage'].allowed,
        canCorrectResponses: values['forms.responses.correct'].allowed,
        correctionStepUpRequired: values['forms.responses.correct'].reason === 'step_up_required',
        canReadSensitiveResponses: values['forms.responses.pii.read'].allowed,
        canExportResponses: values['forms.responses.export'].allowed,
        exportStepUpRequired: values['forms.responses.export'].reason === 'step_up_required',
        canManageTemplates: values['forms.templates.manage'].allowed,
      },
      request,
    );
  }

  @Get('responses/stats')
  async aggregateResponseStats(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(scopeQuerySchema)) scope: ScopeQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      request,
      'forms.responses.read',
      this.accessScope(scope),
      correlationId,
    );
    await this.assertActiveScope(scope.organizationId, scope.branchId);
    return success(
      await this.forms.request('/internal/v1/forms/responses/stats', {
        query: this.scopeQuery(scope),
        correlationId,
      }),
      request,
    );
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
    const scope: AccessScopeDto = body.branchId
      ? { type: 'branch', organizationId: body.organizationId, branchId: body.branchId }
      : { type: 'organization', organizationId: body.organizationId };
    await this.authorize(user.id, request, 'forms.templates.manage', scope, correlationId, {
      type: 'template',
      id: templateId,
    });
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/templates/${templateId}`, {
        method: 'PATCH',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Get(':formId')
  async get(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Query(new ZodValidationPipe(scopeQuerySchema)) scope: ScopeQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.read', this.accessScope(scope), correlationId, {
      type: 'form',
      id: formId,
    });
    await this.assertActiveScope(scope.organizationId, scope.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}`, {
        query: this.scopeQuery(scope),
        correlationId,
      }),
      request,
    );
  }

  @Post(':formId/duplicate')
  @UseGuards(TrustedOriginGuard)
  async duplicate(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Body(new ZodValidationPipe(scopeBodySchema)) body: ScopeBody,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.manage', this.accessScope(body), correlationId, {
      type: 'form',
      id: formId,
    });
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/duplicate`, {
        method: 'POST',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Put(':formId/draft')
  @UseGuards(TrustedOriginGuard)
  async updateDraft(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Body(new ZodValidationPipe(draftSchema)) body: z.infer<typeof draftSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.manage', this.accessScope(body), correlationId, {
      type: 'form',
      id: formId,
    });
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/draft`, {
        method: 'PUT',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Put(':formId/settings')
  @UseGuards(TrustedOriginGuard)
  async updateSettings(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.manage', this.accessScope(body), correlationId, {
      type: 'form',
      id: formId,
    });
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/settings`, {
        method: 'PUT',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Post(':formId/:action')
  @UseGuards(TrustedOriginGuard)
  async changeFormState(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Param('action') action: string,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!['publish', 'pause', 'archive'].includes(action))
      throw new BadRequestException('Unknown form action.');
    if (action === 'archive' && (!body.reason || body.reason.length < 8)) {
      throw new BadRequestException('Archiving a form requires a reason.');
    }
    const formId = this.parseUuid(rawFormId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, request, 'forms.publish', this.accessScope(body), correlationId, {
      type: 'form',
      id: formId,
    });
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/${action}`, {
        method: 'POST',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Get(':formId/responses')
  async listResponses(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Query(new ZodValidationPipe(responseListSchema)) query: z.infer<typeof responseListSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      request,
      'forms.responses.read',
      this.accessScope(query),
      correlationId,
      { type: 'form', id: formId },
    );
    await this.assertActiveScope(query.organizationId, query.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/responses`, {
        query: this.withoutScopeType(query),
        correlationId,
      }),
      request,
    );
  }

  @Get(':formId/responses/stats')
  async responseStats(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Query(new ZodValidationPipe(scopeQuerySchema)) scope: ScopeQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      request,
      'forms.responses.read',
      this.accessScope(scope),
      correlationId,
      { type: 'form', id: formId },
    );
    await this.assertActiveScope(scope.organizationId, scope.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/responses/stats`, {
        query: this.scopeQuery(scope),
        correlationId,
      }),
      request,
    );
  }

  @Get(':formId/responses/export')
  async exportResponses(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Query(new ZodValidationPipe(exportSchema)) query: z.infer<typeof exportSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const correlationId = requestCorrelationId(request);
    const scope = this.accessScope(query);
    await this.authorize(user.id, request, 'forms.responses.export', scope, correlationId, {
      type: 'form',
      id: formId,
    });
    if (query.includeSensitive)
      await this.authorize(user.id, request, 'forms.responses.pii.read', scope, correlationId, {
        type: 'form',
        id: formId,
      });
    await this.assertActiveScope(query.organizationId, query.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/responses/export`, {
        query: { ...this.withoutScopeType(query), actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Get(':formId/responses/:responseId')
  async getResponse(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Param('responseId') rawResponseId: string,
    @Query(
      new ZodValidationPipe(
        scopeQueryBaseSchema
          .extend({ includeSensitive: z.coerce.boolean().default(false) })
          .strict()
          .superRefine(validateScopeQuery),
      ),
    )
    query: ScopeQuery & { includeSensitive: boolean },
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const responseId = this.parseUuid(rawResponseId);
    const correlationId = requestCorrelationId(request);
    const scope = this.accessScope(query);
    await this.authorize(user.id, request, 'forms.responses.read', scope, correlationId, {
      type: 'form',
      id: formId,
    });
    if (query.includeSensitive)
      await this.authorize(user.id, request, 'forms.responses.pii.read', scope, correlationId, {
        type: 'form',
        id: formId,
      });
    await this.assertActiveScope(query.organizationId, query.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/responses/${responseId}`, {
        query: {
          ...this.scopeQuery(query),
          includeSensitive: query.includeSensitive,
          actorUserId: user.id,
          correlationId,
        },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Patch(':formId/responses/:responseId/status')
  @UseGuards(TrustedOriginGuard)
  async updateResponseStatus(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Param('responseId') rawResponseId: string,
    @Body(new ZodValidationPipe(responseStatusSchema)) body: z.infer<typeof responseStatusSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const responseId = this.parseUuid(rawResponseId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      request,
      'forms.responses.manage',
      this.accessScope(body),
      correlationId,
      { type: 'form', id: formId },
    );
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/responses/${responseId}/status`, {
        method: 'PATCH',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Patch(':formId/responses/:responseId/answers')
  @UseGuards(TrustedOriginGuard)
  async correctResponse(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Param('responseId') rawResponseId: string,
    @Body(new ZodValidationPipe(responseCorrectionSchema))
    body: z.infer<typeof responseCorrectionSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const responseId = this.parseUuid(rawResponseId);
    const correlationId = requestCorrelationId(request);
    const scope = this.accessScope(body);
    await this.authorize(user.id, request, 'forms.responses.correct', scope, correlationId, {
      type: 'form',
      id: formId,
    });
    await this.authorize(user.id, request, 'forms.responses.read', scope, correlationId, {
      type: 'form',
      id: formId,
    });
    await this.assertActiveScope(body.organizationId, body.branchId);

    const current = (await this.forms.request(
      `/internal/v1/forms/${formId}/responses/${responseId}`,
      {
        query: {
          ...this.scopeQuery(body),
          includeSensitive: false,
          actorUserId: user.id,
          correlationId,
        },
        actorUserId: user.id,
        correlationId,
      },
    )) as { correctionVersion: number; definition: unknown };
    const definition = formDefinitionSchema.parse(current.definition);
    const sensitiveIds = new Set(
      definition.pages.flatMap((page) =>
        page.fields.filter((field) => field.sensitive).map((field) => field.id),
      ),
    );
    if (body.changes.some((change) => sensitiveIds.has(change.fieldId))) {
      await this.authorize(user.id, request, 'forms.responses.pii.read', scope, correlationId, {
        type: 'form',
        id: formId,
      });
    }
    const result = await this.forms.request(
      `/internal/v1/forms/${formId}/responses/${responseId}/answers`,
      {
        method: 'PATCH',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      },
    );
    return success(result, request);
  }

  @Post(':formId/responses/:responseId/notes')
  @UseGuards(TrustedOriginGuard)
  async addResponseNote(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Param('responseId') rawResponseId: string,
    @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const responseId = this.parseUuid(rawResponseId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      request,
      'forms.responses.manage',
      this.accessScope(body),
      correlationId,
      { type: 'form', id: formId },
    );
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/responses/${responseId}/notes`, {
        method: 'POST',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  @Put(':formId/responses/:responseId/tags')
  @UseGuards(TrustedOriginGuard)
  async updateResponseTags(
    @CurrentUser() user: { id: string },
    @Param('formId') rawFormId: string,
    @Param('responseId') rawResponseId: string,
    @Body(new ZodValidationPipe(tagsSchema)) body: z.infer<typeof tagsSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const formId = this.parseUuid(rawFormId);
    const responseId = this.parseUuid(rawResponseId);
    const correlationId = requestCorrelationId(request);
    await this.authorize(
      user.id,
      request,
      'forms.responses.manage',
      this.accessScope(body),
      correlationId,
      { type: 'form', id: formId },
    );
    await this.assertActiveScope(body.organizationId, body.branchId);
    return success(
      await this.forms.request(`/internal/v1/forms/${formId}/responses/${responseId}/tags`, {
        method: 'PUT',
        body: { ...body, actorUserId: user.id, correlationId },
        actorUserId: user.id,
        correlationId,
      }),
      request,
    );
  }

  private accessScope(scope: ScopeQuery | ScopeBody): AccessScopeDto {
    if (scope.branchId)
      return { type: 'branch', organizationId: scope.organizationId, branchId: scope.branchId };
    return { type: 'organization', organizationId: scope.organizationId };
  }

  private scopeQuery(scope: ScopeQuery | ScopeBody) {
    return {
      organizationId: scope.organizationId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
    };
  }

  private withoutScopeType<T extends { scopeType: string }>(query: T) {
    const { scopeType: _scopeType, ...filters } = query;
    return filters;
  }

  private async authorize(
    userId: string,
    request: AuthenticatedRequest,
    permission: string,
    scope: AccessScopeDto,
    correlationId: string,
    resource?: { type: string; id: string },
  ) {
    const result = await this.evaluate(userId, request, permission, scope, correlationId, resource);
    if (!result.allowed) {
      const reason =
        result.reason === 'step_up_required'
          ? 'MFA step-up is required for this operation.'
          : 'Form permission is required for this operation.';
      throw new DomainError('FORBIDDEN', reason);
    }
  }

  private async evaluate(
    userId: string,
    request: AuthenticatedRequest,
    permission: string,
    scope: AccessScopeDto,
    correlationId: string,
    resource?: { type: string; id: string },
  ) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'Session is invalid.');
    return this.identityAccess.evaluateAuthorization(
      userId,
      request.session,
      { permission, scope, ...(resource ? { resource } : {}) },
      correlationId,
    );
  }

  private async assertActiveScope(organizationId: string, branchId?: string) {
    const organization = await this.organizationBranch.getOrganization(organizationId);
    if (organization.status !== 'active')
      throw new DomainError('CONFLICT', 'Organization is not active.');
    if (!branchId) return;
    const branch = await this.organizationBranch.getOrganizationBranch(organizationId, branchId);
    if (branch.organizationId.toLowerCase() !== organizationId.toLowerCase())
      throw new DomainError('NOT_FOUND', 'Branch was not found in this organization.');
    if (branch.status !== 'active') throw new DomainError('CONFLICT', 'Branch is not active.');
  }

  private parseUuid(value: string) {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) throw new BadRequestException('Resource identifier is invalid.');
    return parsed.data;
  }
}
