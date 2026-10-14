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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { formDefinitionSchema, formThemeSchema } from '@funtino/forms-schema';
import { FormsService, type TenantScope } from '../../application/forms.service.js';
import { FormsServiceTokenGuard } from './service-token.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const scopeSchema = z.object({ organizationId: uuid, branchId: uuid.optional() }).strict();
const correlation = z.string().uuid();
const metaSchema = z.object({ actorUserId: uuid, correlationId: correlation }).strict();
const formListSchema = scopeSchema
  .extend({
    status: z.enum(['draft', 'published', 'paused', 'archived']).optional(),
    query: z.string().trim().max(120).optional(),
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const createFormSchema = z
  .object({
    organizationId: uuid,
    branchId: uuid,
    title: z.string().trim().min(1).max(160),
    ...metaSchema.shape,
  })
  .strict();
const draftSchema = z
  .object({
    ...scopeSchema.shape,
    definition: formDefinitionSchema,
    ...metaSchema.shape,
  })
  .strict();
const settingsSchema = z
  .object({
    ...scopeSchema.shape,
    accessMode: z.enum(['guest', 'optional_auth', 'auth_required']),
    linkEnabled: z.boolean(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    responseLimit: z.number().int().positive().nullable().optional(),
    ...metaSchema.shape,
  })
  .strict();
const reasonSchema = z
  .object({ ...scopeSchema.shape, reason: z.string().trim().min(8).max(500), ...metaSchema.shape })
  .strict();
const optionalReasonSchema = z
  .object({
    ...scopeSchema.shape,
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
    ...metaSchema.shape,
  })
  .strict();
const responseListSchema = scopeSchema
  .extend({
    status: z.enum(['new', 'in_review', 'followed_up', 'closed', 'spam']).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    searchFieldId: uuid.optional(),
    search: z.string().trim().max(100).optional(),
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const responseStatusSchema = z
  .object({
    ...scopeSchema.shape,
    status: z.enum(['new', 'in_review', 'followed_up', 'closed', 'spam']),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => value || undefined),
    ...metaSchema.shape,
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
const responseCorrectionSchema = z
  .object({
    ...scopeSchema.shape,
    expectedVersion: z.number().int().nonnegative(),
    changes: z
      .array(z.object({ fieldId: uuid, value: jsonAnswerSchema }).strict())
      .min(1)
      .max(100),
    reason: z.string().trim().min(8).max(500),
    ...metaSchema.shape,
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
const noteSchema = z
  .object({ ...scopeSchema.shape, body: z.string().trim().min(1).max(2000), ...metaSchema.shape })
  .strict();
const tagsSchema = z
  .object({
    ...scopeSchema.shape,
    tags: z.array(z.string().trim().min(1).max(40)).max(12),
    ...metaSchema.shape,
  })
  .strict();
const exportSchema = scopeSchema
  .extend({
    status: z.enum(['new', 'in_review', 'followed_up', 'closed', 'spam']).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    includeSensitive: z.coerce.boolean().default(false),
    ...metaSchema.shape,
  })
  .strict();
const templateListSchema = z
  .object({
    scopeType: z.enum(['global', 'organization', 'branch']).optional(),
    organizationId: uuid.optional(),
    branchId: uuid.optional(),
    enabledOnly: z.coerce.boolean().default(false),
  })
  .strict();
const createTemplateSchema = z
  .object({
    scopeType: z.enum(['global', 'organization', 'branch']),
    organizationId: uuid.optional(),
    branchId: uuid.optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    definition: formDefinitionSchema,
    ...metaSchema.shape,
  })
  .strict();
const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    definition: formDefinitionSchema.optional(),
    enabled: z.boolean().optional(),
    organizationId: uuid.optional(),
    branchId: uuid.optional(),
    ...metaSchema.shape,
  })
  .strict();
const updateTenantTemplateSchema = updateTemplateSchema.extend({ organizationId: uuid }).strict();
const publicSubmitSchema = z
  .object({
    answers: z.record(z.unknown()),
    idempotencyKey: z.string().trim().min(16).max(80),
    isAuthenticated: z.boolean(),
    customerId: uuid.optional(),
    linkToAccountConsent: z.boolean().default(false),
    linkParameters: z
      .object({
        source: z.string().max(160).optional(),
        campaign: z.string().max(160).optional(),
        ref: z.string().max(160).optional(),
      })
      .strict()
      .optional(),
    correlationId: correlation,
  })
  .strict();
const publicListSchema = z.object({ branchId: uuid.optional() }).strict();
const platformSettingsSchema = z
  .object({ defaultTheme: formThemeSchema, ...metaSchema.shape })
  .strict();
const systemFormListSchema = z
  .object({
    organizationId: uuid.optional(),
    branchId: uuid.optional(),
    status: z.enum(['draft', 'published', 'paused', 'archived']).optional(),
    query: z.string().trim().max(120).optional(),
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

function scopeFrom(value: TenantScope): TenantScope {
  return {
    organizationId: value.organizationId,
    ...(value.branchId ? { branchId: value.branchId } : {}),
  };
}

@Controller('internal/v1/forms')
@UseGuards(FormsServiceTokenGuard)
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(formListSchema)) query: z.infer<typeof formListSchema>) {
    return this.forms.listForms(query);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createFormSchema)) body: z.infer<typeof createFormSchema>) {
    return this.forms.createForm(body, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Post(':formId/duplicate')
  duplicate(
    @Param('formId') formId: string,
    @Body(new ZodValidationPipe(z.object({ ...scopeSchema.shape, ...metaSchema.shape }).strict()))
    body: z.infer<typeof scopeSchema> & z.infer<typeof metaSchema>,
  ) {
    return this.forms.duplicateForm(uuid.parse(formId), body, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Get('templates')
  listTemplates(
    @Query(new ZodValidationPipe(templateListSchema)) query: z.infer<typeof templateListSchema>,
  ) {
    return this.forms.listTemplates(query);
  }

  @Post('templates')
  createTemplate(
    @Body(new ZodValidationPipe(createTemplateSchema)) body: z.infer<typeof createTemplateSchema>,
  ) {
    return this.forms.createTemplate(body, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Patch('templates/:templateId')
  updateTemplate(
    @Param('templateId') templateId: string,
    @Body(new ZodValidationPipe(updateTenantTemplateSchema))
    body: z.infer<typeof updateTenantTemplateSchema>,
  ) {
    return this.forms.updateTemplate(
      uuid.parse(templateId),
      body,
      { actorUserId: body.actorUserId, correlationId: body.correlationId },
      scopeFrom(body),
    );
  }

  @Get(':formId')
  get(
    @Param('formId') formId: string,
    @Query(new ZodValidationPipe(scopeSchema)) scope: z.infer<typeof scopeSchema>,
  ) {
    return this.forms.getForm(uuid.parse(formId), scope);
  }

  @Put(':formId/draft')
  updateDraft(
    @Param('formId') formId: string,
    @Body(new ZodValidationPipe(draftSchema)) body: z.infer<typeof draftSchema>,
  ) {
    return this.forms.updateDraft(uuid.parse(formId), scopeFrom(body), body.definition, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Put(':formId/settings')
  settings(
    @Param('formId') formId: string,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
  ) {
    return this.forms.updateSettings(uuid.parse(formId), scopeFrom(body), body, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Post(':formId/publish')
  publish(
    @Param('formId') formId: string,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
  ) {
    return this.forms.publish(uuid.parse(formId), scopeFrom(body), body.reason ?? null, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Post(':formId/pause')
  pause(
    @Param('formId') formId: string,
    @Body(new ZodValidationPipe(optionalReasonSchema)) body: z.infer<typeof optionalReasonSchema>,
  ) {
    return this.forms.pause(uuid.parse(formId), scopeFrom(body), body.reason ?? null, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Post(':formId/archive')
  archive(
    @Param('formId') formId: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.forms.archive(uuid.parse(formId), scopeFrom(body), body.reason, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Get(':formId/responses')
  listResponses(
    @Param('formId') formId: string,
    @Query(new ZodValidationPipe(responseListSchema)) query: z.infer<typeof responseListSchema>,
  ) {
    return this.forms.listResponses({ ...query, formId: uuid.parse(formId) });
  }

  @Get(':formId/responses/stats')
  responseStats(
    @Param('formId') formId: string,
    @Query(new ZodValidationPipe(scopeSchema)) scope: z.infer<typeof scopeSchema>,
  ) {
    return this.forms.responseStats({ ...scope, formId: uuid.parse(formId) });
  }

  @Get('responses/stats')
  aggregateResponseStats(
    @Query(new ZodValidationPipe(scopeSchema)) scope: z.infer<typeof scopeSchema>,
  ) {
    return this.forms.responseStats(scope);
  }

  @Get(':formId/responses/export')
  exportResponses(
    @Param('formId') formId: string,
    @Query(new ZodValidationPipe(exportSchema)) query: z.infer<typeof exportSchema>,
  ) {
    return this.forms.exportResponses(
      { ...query, formId: uuid.parse(formId) },
      { actorUserId: query.actorUserId, correlationId: query.correlationId },
    );
  }

  @Get(':formId/responses/:responseId')
  getResponse(
    @Param('formId') formId: string,
    @Param('responseId') responseId: string,
    @Query(
      new ZodValidationPipe(
        scopeSchema.extend({
          includeSensitive: z.coerce.boolean().default(false),
          ...metaSchema.shape,
        }),
      ),
    )
    query: z.infer<typeof scopeSchema> & { includeSensitive: boolean } & z.infer<typeof metaSchema>,
  ) {
    return this.forms.getResponse(
      uuid.parse(formId),
      uuid.parse(responseId),
      query,
      query.includeSensitive,
      { actorUserId: query.actorUserId, correlationId: query.correlationId },
    );
  }

  @Patch(':formId/responses/:responseId/answers')
  correctResponse(
    @Param('formId') formId: string,
    @Param('responseId') responseId: string,
    @Body(new ZodValidationPipe(responseCorrectionSchema))
    body: z.infer<typeof responseCorrectionSchema>,
  ) {
    return this.forms.correctResponse(
      uuid.parse(formId),
      uuid.parse(responseId),
      scopeFrom(body),
      body.expectedVersion,
      body.changes,
      body.reason,
      { actorUserId: body.actorUserId, correlationId: body.correlationId },
    );
  }

  @Patch(':formId/responses/:responseId/status')
  updateResponseStatus(
    @Param('formId') formId: string,
    @Param('responseId') responseId: string,
    @Body(new ZodValidationPipe(responseStatusSchema)) body: z.infer<typeof responseStatusSchema>,
  ) {
    return this.forms.updateResponseStatus(
      uuid.parse(formId),
      uuid.parse(responseId),
      scopeFrom(body),
      body.status,
      body.reason ?? null,
      { actorUserId: body.actorUserId, correlationId: body.correlationId },
    );
  }

  @Post(':formId/responses/:responseId/notes')
  addNote(
    @Param('formId') formId: string,
    @Param('responseId') responseId: string,
    @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>,
  ) {
    return this.forms.addResponseNote(
      uuid.parse(formId),
      uuid.parse(responseId),
      scopeFrom(body),
      body.body,
      { actorUserId: body.actorUserId, correlationId: body.correlationId },
    );
  }

  @Put(':formId/responses/:responseId/tags')
  updateTags(
    @Param('formId') formId: string,
    @Param('responseId') responseId: string,
    @Body(new ZodValidationPipe(tagsSchema)) body: z.infer<typeof tagsSchema>,
  ) {
    return this.forms.updateResponseTags(
      uuid.parse(formId),
      uuid.parse(responseId),
      scopeFrom(body),
      body.tags,
      { actorUserId: body.actorUserId, correlationId: body.correlationId },
    );
  }
}

@Controller('internal/v1/public/forms')
@UseGuards(FormsServiceTokenGuard)
export class PublicFormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(publicListSchema)) query: z.infer<typeof publicListSchema>) {
    return this.forms.publicForms(query.branchId);
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.forms.publicForm(slug);
  }

  @Post(':slug/responses')
  submit(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(publicSubmitSchema)) body: z.infer<typeof publicSubmitSchema>,
  ) {
    return this.forms.submitResponse({ ...body, slug }, { correlationId: body.correlationId });
  }
}

@Controller('internal/v1/system/forms')
@UseGuards(FormsServiceTokenGuard)
export class SystemFormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  listForms(
    @Query(new ZodValidationPipe(systemFormListSchema)) query: z.infer<typeof systemFormListSchema>,
  ) {
    return this.forms.listPlatformForms(query);
  }

  @Get('templates')
  listGlobalTemplates() {
    return this.forms.listTemplates({ scopeType: 'global', enabledOnly: false });
  }

  @Post('templates')
  createGlobalTemplate(
    @Body(new ZodValidationPipe(createTemplateSchema)) body: z.infer<typeof createTemplateSchema>,
  ) {
    if (body.scopeType !== 'global') throw new BadRequestException('قالب سامانه باید سراسری باشد.');
    return this.forms.createTemplate(body, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }

  @Patch('templates/:templateId')
  updateGlobalTemplate(
    @Param('templateId') templateId: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: z.infer<typeof updateTemplateSchema>,
  ) {
    return this.forms.updateTemplate(
      uuid.parse(templateId),
      body,
      { actorUserId: body.actorUserId, correlationId: body.correlationId },
      undefined,
      'global',
    );
  }

  @Get('settings')
  settings() {
    return this.forms.getPlatformSettings();
  }

  @Put('settings')
  updateSettings(
    @Body(new ZodValidationPipe(platformSettingsSchema))
    body: z.infer<typeof platformSettingsSchema>,
  ) {
    return this.forms.updatePlatformSettings(body, {
      actorUserId: body.actorUserId,
      correlationId: body.correlationId,
    });
  }
}
