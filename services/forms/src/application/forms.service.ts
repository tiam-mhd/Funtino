import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import { Prisma } from '../../generated/prisma/index.js';
import { canTransitionResponseStatus } from '../domain/response-status.js';
import {
  createEmptyFormDefinition,
  formAccessSchema,
  formDefinitionSchema,
  formThemeSchema,
  responseStatusSchema,
  validateFormSubmission,
  validateFormFieldAnswer,
  visibleFields,
  visiblePages,
  type FormAccess,
  type FormAnswers,
  type FormDefinition,
  type FormStatus,
  type ResponseStatus,
  type FormTheme,
} from '@funtino/forms-schema';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

export type TenantScope = { organizationId: string; branchId?: string };
export type CommandMeta = { actorUserId: string; correlationId: string };

const allowedPublicParameters = ['source', 'campaign', 'ref'] as const;
const defaultTheme = formThemeSchema.parse({});
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function emptyDefinition(title: string, theme: FormTheme = defaultTheme): FormDefinition {
  return createEmptyFormDefinition(title, theme);
}

function safeDefinition(value: unknown): FormDefinition {
  const parsed = formDefinitionSchema.safeParse(value);
  if (!parsed.success) throw new ConflictException('فرم منتشرشده در حال حاضر قابل نمایش نیست.');
  return parsed.data;
}

function makeSlug(title: string): string {
  const stem = title
    .normalize('NFKC')
    .toLocaleLowerCase('fa-IR')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 68);
  return `${stem || 'form'}-${randomUUID().slice(0, 8)}`;
}

function formWhere(formId: string, scope: TenantScope) {
  return {
    id: formId,
    organizationId: scope.organizationId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
  };
}

function sensitiveFieldIds(definition: FormDefinition): Set<string> {
  return new Set(
    definition.pages.flatMap((page) =>
      page.fields.filter((field) => field.sensitive).map((field) => field.id),
    ),
  );
}

function hasSensitiveFields(definition: FormDefinition): boolean {
  return sensitiveFieldIds(definition).size > 0;
}

function redactAnswers(
  answers: unknown,
  definition: FormDefinition,
  includeSensitive: boolean,
): FormAnswers {
  const result =
    answers && typeof answers === 'object' && !Array.isArray(answers)
      ? { ...(answers as FormAnswers) }
      : {};
  if (!includeSensitive) for (const id of sensitiveFieldIds(definition)) delete result[id];
  return result;
}

function stringifyAnswer(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function csvCell(value: unknown): string {
  let text = stringifyAnswer(value).replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,
    ' ',
  );
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}

function safeDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('تاریخ فیلتر معتبر نیست.');
  return date;
}

@Injectable()
export class FormsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForm(input: TenantScope & { title: string }, meta: CommandMeta) {
    const title = input.title.trim();
    if (!title) throw new BadRequestException('عنوان فرم الزامی است.');
    const branchId = input.branchId;
    if (!branchId) throw new BadRequestException('فرم باید به یک شعبهٔ معتبر متصل باشد.');
    const platformSettings = await this.prisma.formPlatformSettings.findUnique({
      where: { id: 1 },
    });
    const definition = emptyDefinition(
      title,
      formThemeSchema.parse(platformSettings?.defaultTheme ?? defaultTheme),
    );
    const form = await this.prisma.$transaction(async (tx) => {
      const created = await tx.form.create({
        data: {
          organizationId: input.organizationId,
          branchId,
          title,
          slug: makeSlug(title),
          description: '',
          accessMode: 'guest',
          draftSchema: toJson(definition),
          createdByUserId: meta.actorUserId,
          updatedByUserId: meta.actorUserId,
        },
      });
      await this.audit(tx, {
        action: 'form.created',
        targetType: 'form',
        targetId: created.id,
        actorUserId: meta.actorUserId,
        organizationId: created.organizationId,
        branchId: created.branchId,
        correlationId: meta.correlationId,
      });
      return created;
    });
    return form;
  }

  async duplicateForm(formId: string, scope: TenantScope, meta: CommandMeta) {
    const original = await this.requireForm(formId, scope);
    const definition = safeDefinition(original.draftSchema);
    definition.title = `${definition.title} (نسخهٔ کپی)`;
    return this.createForm(
      { ...scope, branchId: original.branchId, title: definition.title },
      meta,
    ).then(async (created) => {
      await this.updateDraft(created.id, scope, definition, meta);
      return this.requireForm(created.id, scope);
    });
  }

  async listForms(
    input: TenantScope & { status?: FormStatus; query?: string; cursor?: string; pageSize: number },
  ) {
    const pageSize = Math.max(1, Math.min(100, input.pageSize));
    const rows = await this.prisma.form.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.query ? { title: { contains: input.query.trim(), mode: 'insensitive' } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map(({ draftSchema: _draft, ...item }) => item);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async listPlatformForms(input: {
    organizationId?: string;
    branchId?: string;
    status?: FormStatus;
    query?: string;
    cursor?: string;
    pageSize: number;
  }) {
    const pageSize = Math.max(1, Math.min(100, input.pageSize));
    const rows = await this.prisma.form.findMany({
      where: {
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.query ? { title: { contains: input.query.trim(), mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        slug: true,
        title: true,
        description: true,
        status: true,
        accessMode: true,
        linkEnabled: true,
        responseCount: true,
        currentVersion: true,
        createdAt: true,
        publishedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  requireForm(formId: string, scope: TenantScope) {
    return this.prisma.form.findFirst({ where: formWhere(formId, scope) }).then((form) => {
      if (!form) throw new NotFoundException('فرم در این محدوده پیدا نشد.');
      return form;
    });
  }

  async getForm(formId: string, scope: TenantScope) {
    const form = await this.requireForm(formId, scope);
    const version = form.currentVersion
      ? await this.prisma.formVersion.findUnique({
          where: { formId_version: { formId: form.id, version: form.currentVersion } },
        })
      : null;
    return {
      ...form,
      draftSchema: safeDefinition(form.draftSchema),
      publishedDefinition: version ? safeDefinition(version.definition) : null,
    };
  }

  async updateDraft(formId: string, scope: TenantScope, rawDefinition: unknown, meta: CommandMeta) {
    const parsed = formDefinitionSchema.safeParse(rawDefinition);
    if (!parsed.success) throw new BadRequestException('ساختار فرم معتبر نیست.');
    return this.prisma.$transaction(async (tx) => {
      const form = await tx.form.findFirst({ where: formWhere(formId, scope) });
      if (!form) throw new NotFoundException('فرم در این محدوده پیدا نشد.');
      if (form.status === 'archived')
        throw new ConflictException('فرم بایگانی‌شده قابل ویرایش نیست.');
      const updated = await tx.form.update({
        where: { id: form.id },
        data: {
          title: parsed.data.title,
          description: parsed.data.description,
          draftSchema: toJson(parsed.data),
          updatedByUserId: meta.actorUserId,
        },
      });
      await this.audit(tx, {
        action: 'form.draft.updated',
        targetType: 'form',
        targetId: form.id,
        actorUserId: meta.actorUserId,
        organizationId: form.organizationId,
        branchId: form.branchId,
        correlationId: meta.correlationId,
      });
      return { ...updated, draftSchema: parsed.data };
    });
  }

  async updateSettings(
    formId: string,
    scope: TenantScope,
    input: {
      accessMode: FormAccess;
      linkEnabled: boolean;
      startsAt?: string | null;
      endsAt?: string | null;
      responseLimit?: number | null;
    },
    meta: CommandMeta,
  ) {
    const accessMode = formAccessSchema.parse(input.accessMode);
    const startsAt = input.startsAt ? safeDate(input.startsAt) : null;
    const endsAt = input.endsAt ? safeDate(input.endsAt) : null;
    if (startsAt && endsAt && endsAt <= startsAt)
      throw new BadRequestException('پایان دسترسی باید پس از شروع باشد.');
    if (
      input.responseLimit !== undefined &&
      input.responseLimit !== null &&
      (!Number.isSafeInteger(input.responseLimit) || input.responseLimit < 1)
    ) {
      throw new BadRequestException('سقف پاسخ باید عددی مثبت باشد.');
    }
    return this.prisma.$transaction(async (tx) => {
      const form = await tx.form.findFirst({ where: formWhere(formId, scope) });
      if (!form) throw new NotFoundException('فرم در این محدوده پیدا نشد.');
      if (form.status === 'archived')
        throw new ConflictException('فرم بایگانی‌شده قابل تغییر نیست.');
      const updated = await tx.form.update({
        where: { id: form.id },
        data: {
          accessMode,
          linkEnabled: input.linkEnabled,
          startsAt,
          endsAt,
          responseLimit: input.responseLimit ?? null,
          updatedByUserId: meta.actorUserId,
        },
      });
      await this.audit(tx, {
        action: 'form.settings.updated',
        targetType: 'form',
        targetId: form.id,
        actorUserId: meta.actorUserId,
        organizationId: form.organizationId,
        branchId: form.branchId,
        correlationId: meta.correlationId,
      });
      return updated;
    });
  }

  async publish(formId: string, scope: TenantScope, reason: string, meta: CommandMeta) {
    return this.prisma.$transaction(async (tx) => {
      const form = await tx.form.findFirst({ where: formWhere(formId, scope) });
      if (!form) throw new NotFoundException('فرم در این محدوده پیدا نشد.');
      if (form.status === 'archived') throw new ConflictException('فرم بایگانی‌شده منتشر نمی‌شود.');
      const parsed = formDefinitionSchema.safeParse(form.draftSchema);
      if (
        !parsed.success ||
        !parsed.data.pages.some((page) =>
          page.fields.some((field) => !['heading', 'paragraph', 'hidden'].includes(field.type)),
        )
      ) {
        throw new BadRequestException('برای انتشار، حداقل یک پرسش قابل پاسخ و معتبر اضافه کنید.');
      }
      const version = (form.currentVersion ?? 0) + 1;
      const snapshot = await tx.formVersion.create({
        data: {
          formId: form.id,
          version,
          schemaVersion: parsed.data.schemaVersion,
          definition: toJson(parsed.data),
          publishedById: meta.actorUserId,
        },
      });
      const updated = await tx.form.update({
        where: { id: form.id },
        data: {
          status: 'published',
          currentVersion: version,
          publishedAt: new Date(),
          updatedByUserId: meta.actorUserId,
        },
      });
      await this.audit(tx, {
        action: 'form.published',
        targetType: 'form',
        targetId: form.id,
        actorUserId: meta.actorUserId,
        organizationId: form.organizationId,
        branchId: form.branchId,
        reason,
        correlationId: meta.correlationId,
        metadata: { version, formVersionId: snapshot.id },
      });
      await this.recordEvent(
        tx,
        createEventEnvelope({
          eventType: eventTypes.formPublished,
          sourceId: 'forms',
          aggregateId: form.id,
          correlationId: meta.correlationId,
          organizationId: form.organizationId,
          branchId: form.branchId,
          payload: {
            formId: form.id,
            formVersionId: snapshot.id,
            organizationId: form.organizationId,
            branchId: form.branchId,
            version,
          },
        }),
      );
      return { ...updated, publishedDefinition: parsed.data, version: snapshot };
    });
  }

  async pause(formId: string, scope: TenantScope, reason: string, meta: CommandMeta) {
    return this.prisma.$transaction(async (tx) => {
      const form = await tx.form.findFirst({ where: formWhere(formId, scope) });
      if (!form) throw new NotFoundException('فرم در این محدوده پیدا نشد.');
      if (form.status !== 'published')
        throw new ConflictException('فقط فرم منتشرشده را می‌توان متوقف کرد.');
      const updated = await tx.form.update({
        where: { id: form.id },
        data: { status: 'paused', linkEnabled: false, updatedByUserId: meta.actorUserId },
      });
      await this.audit(tx, {
        action: 'form.paused',
        targetType: 'form',
        targetId: form.id,
        actorUserId: meta.actorUserId,
        organizationId: form.organizationId,
        branchId: form.branchId,
        reason,
        correlationId: meta.correlationId,
      });
      await this.recordEvent(
        tx,
        createEventEnvelope({
          eventType: eventTypes.formPaused,
          sourceId: 'forms',
          aggregateId: form.id,
          correlationId: meta.correlationId,
          organizationId: form.organizationId,
          branchId: form.branchId,
          payload: {
            formId: form.id,
            organizationId: form.organizationId,
            branchId: form.branchId,
            version: form.currentVersion ?? 1,
          },
        }),
      );
      return updated;
    });
  }

  async archive(formId: string, scope: TenantScope, reason: string, meta: CommandMeta) {
    return this.prisma.$transaction(async (tx) => {
      const form = await tx.form.findFirst({ where: formWhere(formId, scope) });
      if (!form) throw new NotFoundException('فرم در این محدوده پیدا نشد.');
      if (form.status === 'archived') return form;
      const updated = await tx.form.update({
        where: { id: form.id },
        data: { status: 'archived', linkEnabled: false, updatedByUserId: meta.actorUserId },
      });
      await this.audit(tx, {
        action: 'form.archived',
        targetType: 'form',
        targetId: form.id,
        actorUserId: meta.actorUserId,
        organizationId: form.organizationId,
        branchId: form.branchId,
        reason,
        correlationId: meta.correlationId,
      });
      return updated;
    });
  }

  async publicForms(branchId?: string) {
    const now = new Date();
    const forms = await this.prisma.form.findMany({
      where: {
        status: 'published',
        linkEnabled: true,
        ...(branchId ? { branchId } : {}),
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        branchId: true,
        responseCount: true,
        responseLimit: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
    return forms
      .filter((form) => form.responseLimit === null || form.responseCount < form.responseLimit)
      .map(({ responseCount: _count, responseLimit: _limit, ...form }) => form);
  }

  async publicForm(slug: string) {
    const form = await this.prisma.form.findUnique({
      where: { slug },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (
      !form ||
      form.status !== 'published' ||
      !form.linkEnabled ||
      !this.isInAvailabilityWindow(form)
    )
      throw new NotFoundException('این فرم در دسترس نیست.');
    if (form.responseLimit !== null && form.responseCount >= form.responseLimit)
      throw new ConflictException('ظرفیت پاسخ‌گویی این فرم تکمیل شده است.');
    const version = form.versions[0];
    if (!version || version.version !== form.currentVersion)
      throw new NotFoundException('این فرم در دسترس نیست.');
    return {
      id: form.id,
      slug: form.slug,
      accessMode: form.accessMode,
      currentVersionId: version.id,
      definition: safeDefinition(version.definition),
      endsAt: form.endsAt?.toISOString() ?? null,
    };
  }

  async submitResponse(
    input: {
      slug: string;
      answers: unknown;
      idempotencyKey: string;
      isAuthenticated: boolean;
      customerId?: string;
      linkToAccountConsent: boolean;
      linkParameters?: Record<string, string | undefined>;
    },
    meta: { correlationId: string },
  ) {
    const form = await this.prisma.form.findUnique({
      where: { slug: input.slug },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (
      !form ||
      form.status !== 'published' ||
      !form.linkEnabled ||
      !this.isInAvailabilityWindow(form)
    )
      throw new NotFoundException('این فرم در دسترس نیست.');
    if (form.responseLimit !== null && form.responseCount >= form.responseLimit)
      throw new ConflictException('ظرفیت پاسخ‌گویی این فرم تکمیل شده است.');
    if (form.accessMode === 'auth_required' && !input.isAuthenticated)
      throw new ForbiddenException('برای پاسخ‌گویی به این فرم ابتدا وارد حساب مشتری شوید.');
    if (input.linkToAccountConsent && (!input.isAuthenticated || !input.customerId))
      throw new BadRequestException('برای اتصال پاسخ به حساب، ورود معتبر و رضایت صریح لازم است.');
    if (input.customerId && !input.linkToAccountConsent)
      throw new BadRequestException('اتصال پاسخ به حساب نیازمند رضایت صریح است.');
    if (input.customerId && !input.isAuthenticated)
      throw new BadRequestException('شناسه مشتری معتبر نیست.');
    const version = form.versions[0];
    if (!version || version.version !== form.currentVersion)
      throw new ConflictException('نسخهٔ فعال فرم در دسترس نیست.');
    const definition = safeDefinition(version.definition);
    const params: Record<string, string | undefined> = {};
    for (const key of allowedPublicParameters) params[key] = input.linkParameters?.[key];
    const validation = validateFormSubmission(definition, input.answers, params);
    if (!validation.success) return { status: 'invalid', issues: validation.issues } as const;
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          versionId: version.id,
          answers: validation.answers,
          customerId: input.customerId ?? null,
        }),
      )
      .digest('hex');

    const existing = await this.prisma.formResponse.findUnique({
      where: { formId_idempotencyKey: { formId: form.id, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash)
        throw new ConflictException('کلید idempotency قبلاً با پاسخ متفاوت استفاده شده است.');
      return {
        status: 'submitted',
        responseId: existing.id,
        submittedAt: existing.submittedAt.toISOString(),
        duplicate: true,
      } as const;
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM forms.forms WHERE id = ${form.id}::uuid FOR UPDATE`;
        const freshForm = await tx.form.findUnique({ where: { id: form.id } });
        if (
          !freshForm ||
          freshForm.status !== 'published' ||
          !freshForm.linkEnabled ||
          !this.isInAvailabilityWindow(freshForm)
        )
          throw new NotFoundException('این فرم در دسترس نیست.');
        if (freshForm.responseLimit !== null && freshForm.responseCount >= freshForm.responseLimit)
          throw new ConflictException('ظرفیت پاسخ‌گویی این فرم تکمیل شده است.');
        const response = await tx.formResponse.create({
          data: {
            organizationId: form.organizationId,
            branchId: form.branchId,
            formId: form.id,
            formVersionId: version.id,
            ...(input.customerId
              ? { customerId: input.customerId, customerConsentAt: new Date() }
              : {}),
            idempotencyKey: input.idempotencyKey,
            payloadHash,
            answers: toJson(validation.answers),
          },
        });
        await tx.form.update({ where: { id: form.id }, data: { responseCount: { increment: 1 } } });
        await this.recordEvent(
          tx,
          createEventEnvelope({
            eventType: eventTypes.formResponseSubmitted,
            sourceId: 'forms',
            aggregateId: response.id,
            correlationId: meta.correlationId,
            organizationId: form.organizationId,
            branchId: form.branchId,
            payload: {
              responseId: response.id,
              formId: form.id,
              formVersionId: version.id,
              organizationId: form.organizationId,
              branchId: form.branchId,
            },
          }),
        );
        return response;
      });
      return {
        status: 'submitted',
        responseId: created.id,
        submittedAt: created.submittedAt.toISOString(),
        duplicate: false,
      } as const;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.formResponse.findUnique({
          where: {
            formId_idempotencyKey: { formId: form.id, idempotencyKey: input.idempotencyKey },
          },
        });
        if (raced?.payloadHash === payloadHash)
          return {
            status: 'submitted',
            responseId: raced.id,
            submittedAt: raced.submittedAt.toISOString(),
            duplicate: true,
          } as const;
      }
      throw error;
    }
  }

  async listResponses(
    input: TenantScope & {
      formId?: string;
      status?: ResponseStatus;
      from?: string;
      to?: string;
      searchFieldId?: string;
      search?: string;
      cursor?: string;
      pageSize: number;
    },
  ) {
    const pageSize = Math.max(1, Math.min(100, input.pageSize));
    const where: Prisma.FormResponseWhereInput = {
      organizationId: input.organizationId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.formId ? { formId: input.formId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.from || input.to
        ? {
            submittedAt: {
              ...(input.from ? { gte: safeDate(input.from) } : {}),
              ...(input.to ? { lte: safeDate(input.to) } : {}),
            },
          }
        : {}),
    };
    if (input.searchFieldId || input.search) {
      if (!input.searchFieldId || !input.search?.trim())
        throw new BadRequestException('فیلد و متن جست‌وجو باید با هم ارسال شوند.');
      const form = input.formId ? await this.requireForm(input.formId, input) : null;
      if (!form) throw new BadRequestException('جست‌وجوی پاسخ فقط با انتخاب یک فرم ممکن است.');
      const definition = safeDefinition(form.draftSchema);
      const field = definition.pages
        .flatMap((page) => page.fields)
        .find((item) => item.id === input.searchFieldId);
      if (!field?.searchable || field.sensitive)
        throw new ForbiddenException('این فیلد برای جست‌وجوی پاسخ مجاز نیست.');
      where.answers = {
        path: [input.searchFieldId],
        string_contains: input.search.trim().slice(0, 100),
      };
    }
    const rows = await this.prisma.formResponse.findMany({
      where,
      include: { formVersion: { select: { definition: true } } },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      branchId: row.branchId,
      formId: row.formId,
      formVersionId: row.formVersionId,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      correctionVersion: row.correctionVersion,
      customerLinked: row.customerId !== null,
      hasSensitive: hasSensitiveFields(safeDefinition(row.formVersion.definition)),
      tags: row.tags,
    }));
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async getResponse(
    formId: string,
    responseId: string,
    scope: TenantScope,
    includeSensitive: boolean,
    meta: CommandMeta,
  ) {
    const response = await this.prisma.formResponse.findFirst({
      where: {
        id: responseId,
        formId,
        organizationId: scope.organizationId,
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
      },
      include: {
        formVersion: true,
        notes: { orderBy: { createdAt: 'asc' } },
        corrections: { orderBy: [{ correctionVersion: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!response) throw new NotFoundException('پاسخ در این محدوده پیدا نشد.');
    const definition = safeDefinition(response.formVersion.definition);
    if (includeSensitive) {
      await this.audit(this.prisma, {
        action: 'response.pii.read',
        targetType: 'response',
        targetId: response.id,
        actorUserId: meta.actorUserId,
        organizationId: response.organizationId,
        branchId: response.branchId,
        correlationId: meta.correlationId,
        metadata: { formId: response.formId, formVersionId: response.formVersionId },
      });
    }
    return {
      id: response.id,
      organizationId: response.organizationId,
      branchId: response.branchId,
      formId: response.formId,
      formVersionId: response.formVersionId,
      status: response.status,
      submittedAt: response.submittedAt.toISOString(),
      correctionVersion: response.correctionVersion,
      customerLinked: response.customerId !== null,
      answers: redactAnswers(response.answers, definition, includeSensitive),
      hasSensitive: hasSensitiveFields(definition),
      definition,
      tags: response.tags,
      notes: response.notes.map(({ id, authorUserId, body, createdAt }) => ({
        id,
        authorUserId,
        body,
        createdAt: createdAt.toISOString(),
      })),
      corrections: response.corrections.map((correction) => {
        const redacted = !includeSensitive && sensitiveFieldIds(definition).has(correction.fieldId);
        return {
          id: correction.id,
          fieldId: correction.fieldId,
          correctionVersion: correction.correctionVersion,
          previousPresent: correction.previousPresent,
          previousValue: redacted ? null : correction.previousValue,
          newPresent: correction.newPresent,
          newValue: redacted ? null : correction.newValue,
          redacted,
          reason: correction.reason,
          actorUserId: correction.actorUserId,
          createdAt: correction.createdAt.toISOString(),
        };
      }),
    };
  }

  async correctResponse(
    formId: string,
    responseId: string,
    scope: TenantScope,
    expectedVersion: number,
    changes: Array<{ fieldId: string; value: unknown }>,
    reason: string,
    meta: CommandMeta,
  ) {
    const correctionReason = reason.trim();
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
      throw new BadRequestException('نسخهٔ پاسخ معتبر نیست.');
    if (correctionReason.length < 8 || correctionReason.length > 500)
      throw new BadRequestException('دلیل اصلاح باید بین ۸ تا ۵۰۰ نویسه باشد.');
    if (changes.length < 1 || changes.length > 100)
      throw new BadRequestException('تعداد فیلدهای اصلاح معتبر نیست.');
    if (new Set(changes.map((change) => change.fieldId)).size !== changes.length)
      throw new BadRequestException('هر فیلد در یک اصلاح فقط یک بار می‌تواند بیاید.');

    return this.prisma.$transaction(async (tx) => {
      const response = await tx.formResponse.findFirst({
        where: {
          id: responseId,
          formId,
          organizationId: scope.organizationId,
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
        },
        include: { formVersion: true },
      });
      if (!response) throw new NotFoundException('پاسخ در این محدوده پیدا نشد.');
      if (response.correctionVersion !== expectedVersion)
        throw new ConflictException('پاسخ هم‌زمان اصلاح شده است؛ آن را دوباره بارگذاری کنید.');

      const definition = safeDefinition(response.formVersion.definition);
      const currentAnswers =
        response.answers && typeof response.answers === 'object' && !Array.isArray(response.answers)
          ? { ...(response.answers as FormAnswers) }
          : {};
      const correctedAnswers = { ...currentAnswers };
      const correctedFields: Array<{
        fieldId: string;
        previousPresent: boolean;
        previousValue: unknown;
        newPresent: boolean;
        newValue: unknown;
      }> = [];
      const availablePages = visiblePages(definition, currentAnswers);

      for (const change of changes) {
        const page = definition.pages.find((item) =>
          item.fields.some((field) => field.id === change.fieldId),
        );
        const field = page?.fields.find((item) => item.id === change.fieldId);
        if (!page || !field || ['hidden', 'heading', 'paragraph'].includes(field.type)) {
          throw new BadRequestException('این فیلد قابل اصلاح نیست.');
        }
        if (
          !availablePages.some((item) => item.id === page.id) ||
          !visibleFields(page, currentAnswers).some((item) => item.id === field.id)
        ) {
          throw new ConflictException('فیلد در پاسخ ثبت‌شده قابل مشاهده نبوده است.');
        }
        const validated = validateFormFieldAnswer(field, change.value);
        if (!validated.success) throw new BadRequestException(validated.issue.message);

        const previousPresent = Object.prototype.hasOwnProperty.call(currentAnswers, field.id);
        const previousValue = currentAnswers[field.id];
        const newPresent =
          validated.value !== undefined &&
          validated.value !== null &&
          validated.value !== '' &&
          !(Array.isArray(validated.value) && validated.value.length === 0);
        const newValue = validated.value;
        if (
          previousPresent === newPresent &&
          JSON.stringify(previousValue) === JSON.stringify(newValue)
        )
          continue;
        if (newPresent) correctedAnswers[field.id] = newValue;
        else delete correctedAnswers[field.id];
        correctedFields.push({
          fieldId: field.id,
          previousPresent,
          previousValue,
          newPresent,
          newValue,
        });
      }

      if (correctedFields.length === 0)
        throw new ConflictException('مقدار تازه‌ای برای ثبت وجود ندارد.');
      const correctionVersion = response.correctionVersion + 1;
      const updated = await tx.formResponse.updateMany({
        where: { id: response.id, correctionVersion: expectedVersion },
        data: { answers: toJson(correctedAnswers), correctionVersion: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new ConflictException('پاسخ هم‌زمان اصلاح شده است؛ آن را دوباره بارگذاری کنید.');

      await tx.formResponseCorrection.createMany({
        data: correctedFields.map((field) => ({
          responseId: response.id,
          fieldId: field.fieldId,
          correctionVersion,
          previousPresent: field.previousPresent,
          previousValue: toJson(field.previousPresent ? field.previousValue : {}),
          newPresent: field.newPresent,
          newValue: toJson(field.newPresent ? field.newValue : {}),
          reason: correctionReason,
          actorUserId: meta.actorUserId,
        })),
      });
      await this.audit(tx, {
        action: 'response.answers.corrected',
        targetType: 'response',
        targetId: response.id,
        actorUserId: meta.actorUserId,
        organizationId: response.organizationId,
        branchId: response.branchId,
        reason: correctionReason,
        correlationId: meta.correlationId,
        metadata: {
          formId: response.formId,
          correctionVersion,
          changedFieldCount: correctedFields.length,
        },
      });
      await this.recordEvent(
        tx,
        createEventEnvelope({
          eventType: eventTypes.formResponseCorrected,
          sourceId: 'forms',
          aggregateId: response.id,
          correlationId: meta.correlationId,
          organizationId: response.organizationId,
          branchId: response.branchId,
          payload: {
            responseId: response.id,
            formId: response.formId,
            organizationId: response.organizationId,
            branchId: response.branchId,
            correctionVersion,
            changedFieldCount: correctedFields.length,
          },
        }),
      );
      return { id: response.id, correctionVersion, changedFieldCount: correctedFields.length };
    });
  }

  async updateResponseStatus(
    formId: string,
    responseId: string,
    scope: TenantScope,
    status: ResponseStatus,
    reason: string,
    meta: CommandMeta,
  ) {
    const nextStatus = responseStatusSchema.parse(status);
    return this.prisma.$transaction(async (tx) => {
      const response = await tx.formResponse.findFirst({
        where: {
          id: responseId,
          formId,
          organizationId: scope.organizationId,
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
        },
      });
      if (!response) throw new NotFoundException('پاسخ در این محدوده پیدا نشد.');
      if (response.status === nextStatus) return response;
      if (!canTransitionResponseStatus(response.status, nextStatus)) {
        throw new ConflictException('تغییر وضعیت پاسخ از این حالت مجاز نیست.');
      }
      const updated = await tx.formResponse.update({
        where: { id: response.id },
        data: { status: nextStatus },
      });
      await this.audit(tx, {
        action: 'response.status.changed',
        targetType: 'response',
        targetId: response.id,
        actorUserId: meta.actorUserId,
        organizationId: response.organizationId,
        branchId: response.branchId,
        reason,
        correlationId: meta.correlationId,
        metadata: { previousStatus: response.status, status: nextStatus },
      });
      await this.recordEvent(
        tx,
        createEventEnvelope({
          eventType: eventTypes.formResponseStatusChanged,
          sourceId: 'forms',
          aggregateId: response.id,
          correlationId: meta.correlationId,
          organizationId: response.organizationId,
          branchId: response.branchId,
          payload: {
            responseId: response.id,
            formId: response.formId,
            organizationId: response.organizationId,
            branchId: response.branchId,
            previousStatus: response.status,
            status: nextStatus,
          },
        }),
      );
      return updated;
    });
  }

  async addResponseNote(
    formId: string,
    responseId: string,
    scope: TenantScope,
    body: string,
    meta: CommandMeta,
  ) {
    const noteBody = body.trim();
    if (noteBody.length < 1 || noteBody.length > 2000)
      throw new BadRequestException('یادداشت باید بین ۱ تا ۲۰۰۰ نویسه باشد.');
    return this.prisma.$transaction(async (tx) => {
      const response = await tx.formResponse.findFirst({
        where: {
          id: responseId,
          formId,
          organizationId: scope.organizationId,
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
        },
      });
      if (!response) throw new NotFoundException('پاسخ در این محدوده پیدا نشد.');
      const note = await tx.formResponseNote.create({
        data: { responseId, authorUserId: meta.actorUserId, body: noteBody },
      });
      await this.audit(tx, {
        action: 'response.note.added',
        targetType: 'response',
        targetId: response.id,
        actorUserId: meta.actorUserId,
        organizationId: response.organizationId,
        branchId: response.branchId,
        correlationId: meta.correlationId,
        metadata: { noteId: note.id },
      });
      return note;
    });
  }

  async updateResponseTags(
    formId: string,
    responseId: string,
    scope: TenantScope,
    tags: string[],
    meta: CommandMeta,
  ) {
    const cleanedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
    if (cleanedTags.some((tag) => tag.length > 40))
      throw new BadRequestException('هر برچسب حداکثر ۴۰ نویسه است.');
    return this.prisma.$transaction(async (tx) => {
      const response = await tx.formResponse.findFirst({
        where: {
          id: responseId,
          formId,
          organizationId: scope.organizationId,
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
        },
      });
      if (!response) throw new NotFoundException('پاسخ در این محدوده پیدا نشد.');
      const updated = await tx.formResponse.update({
        where: { id: response.id },
        data: { tags: cleanedTags },
      });
      await this.audit(tx, {
        action: 'response.tags.updated',
        targetType: 'response',
        targetId: response.id,
        actorUserId: meta.actorUserId,
        organizationId: response.organizationId,
        branchId: response.branchId,
        correlationId: meta.correlationId,
        metadata: { tagCount: cleanedTags.length },
      });
      return { id: updated.id, tags: updated.tags };
    });
  }

  async responseStats(scope: TenantScope & { formId?: string }) {
    const where = {
      organizationId: scope.organizationId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(scope.formId ? { formId: scope.formId } : {}),
    };
    const [total, statuses, branches] = await Promise.all([
      this.prisma.formResponse.count({ where }),
      this.prisma.formResponse.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.formResponse.groupBy({ by: ['branchId'], where, _count: { _all: true } }),
    ]);
    return {
      total,
      byStatus: Object.fromEntries(statuses.map((item) => [item.status, item._count._all])),
      byBranch: branches.map((item) => ({ branchId: item.branchId, count: item._count._all })),
    };
  }

  async exportResponses(
    input: TenantScope & {
      formId: string;
      status?: ResponseStatus;
      from?: string;
      to?: string;
      includeSensitive: boolean;
    },
    meta: CommandMeta,
  ) {
    const form = await this.requireForm(input.formId, input);
    const rows = await this.prisma.formResponse.findMany({
      where: {
        organizationId: input.organizationId,
        formId: form.id,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.from || input.to
          ? {
              submittedAt: {
                ...(input.from ? { gte: safeDate(input.from) } : {}),
                ...(input.to ? { lte: safeDate(input.to) } : {}),
              },
            }
          : {}),
      },
      include: { formVersion: true },
      orderBy: { submittedAt: 'desc' },
      take: 5000,
    });
    const fieldMap = new Map<string, string>();
    for (const row of rows) {
      for (const page of safeDefinition(row.formVersion.definition).pages) {
        for (const field of page.fields) {
          if (
            field.type !== 'heading' &&
            field.type !== 'paragraph' &&
            (!field.sensitive || input.includeSensitive)
          )
            fieldMap.set(field.id, field.label);
        }
      }
    }
    const headers = ['شناسه پاسخ', 'وضعیت', 'زمان ثبت', ...fieldMap.values()];
    const lines = [headers.map(csvCell).join(',')];
    for (const row of rows) {
      const definition = safeDefinition(row.formVersion.definition);
      const answers = redactAnswers(row.answers, definition, input.includeSensitive);
      lines.push(
        [
          row.id,
          row.status,
          row.submittedAt.toISOString(),
          ...[...fieldMap.keys()].map((id) => answers[id]),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    await this.audit(this.prisma, {
      action: 'response.exported',
      targetType: 'form',
      targetId: form.id,
      actorUserId: meta.actorUserId,
      organizationId: form.organizationId,
      branchId: input.branchId ?? form.branchId,
      correlationId: meta.correlationId,
      metadata: { count: rows.length, includesSensitive: input.includeSensitive },
    });
    return {
      filename: `forms-${form.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
      content: `\ufeff${lines.join('\r\n')}`,
      exportedCount: rows.length,
      truncated: rows.length === 5000,
    };
  }

  async listTemplates(input: {
    scopeType?: 'global' | 'organization' | 'branch';
    organizationId?: string;
    branchId?: string;
    enabledOnly?: boolean;
  }) {
    const inheritedScope = input.scopeType
      ? {}
      : input.organizationId && input.branchId
        ? {
            OR: [
              { scopeType: 'global' as const },
              {
                scopeType: 'organization' as const,
                organizationId: input.organizationId,
                branchId: null,
              },
              {
                scopeType: 'branch' as const,
                organizationId: input.organizationId,
                branchId: input.branchId,
              },
            ],
          }
        : input.organizationId
          ? {
              OR: [
                { scopeType: 'global' as const },
                {
                  scopeType: 'organization' as const,
                  organizationId: input.organizationId,
                  branchId: null,
                },
              ],
            }
          : {};
    return this.prisma.formTemplate.findMany({
      where: {
        ...(input.scopeType ? { scopeType: input.scopeType } : inheritedScope),
        ...(input.scopeType && input.organizationId
          ? { organizationId: input.organizationId }
          : {}),
        ...(input.scopeType && input.branchId ? { branchId: input.branchId } : {}),
        ...(input.enabledOnly ? { enabled: true } : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }

  async createTemplate(
    input: {
      scopeType: 'global' | 'organization' | 'branch';
      organizationId?: string;
      branchId?: string;
      name: string;
      description?: string;
      definition: unknown;
    },
    meta: CommandMeta,
  ) {
    const definition = formDefinitionSchema.safeParse(input.definition);
    if (!definition.success) throw new BadRequestException('ساختار قالب معتبر نیست.');
    const scopeIsValid =
      input.scopeType === 'global'
        ? !input.organizationId && !input.branchId
        : input.scopeType === 'organization'
          ? Boolean(input.organizationId) && !input.branchId
          : Boolean(input.organizationId && input.branchId);
    if (!scopeIsValid) throw new BadRequestException('محدودهٔ قالب معتبر نیست.');
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.formTemplate.create({
        data: {
          scopeType: input.scopeType,
          organizationId: input.organizationId,
          branchId: input.branchId,
          name: input.name.trim(),
          description: input.description?.trim() ?? '',
          definition: toJson(definition.data),
          createdByUserId: meta.actorUserId,
          updatedByUserId: meta.actorUserId,
        },
      });
      await this.audit(tx, {
        action: 'template.created',
        targetType: 'template',
        targetId: template.id,
        actorUserId: meta.actorUserId,
        organizationId: template.organizationId ?? undefined,
        branchId: template.branchId ?? undefined,
        correlationId: meta.correlationId,
      });
      return template;
    });
  }

  async updateTemplate(
    templateId: string,
    input: { name?: string; description?: string; definition?: unknown; enabled?: boolean },
    meta: CommandMeta,
    scope?: TenantScope,
    expectedScopeType?: 'global',
  ) {
    const existing = await this.prisma.formTemplate.findUnique({ where: { id: templateId } });
    if (!existing) throw new NotFoundException('قالب پیدا نشد.');
    if (expectedScopeType && existing.scopeType !== expectedScopeType)
      throw new NotFoundException('قالب سراسری پیدا نشد.');
    if (
      scope &&
      (existing.scopeType === 'global' ||
        existing.organizationId !== scope.organizationId ||
        (existing.branchId && scope.branchId !== existing.branchId))
    ) {
      throw new NotFoundException('قالب در این محدوده پیدا نشد.');
    }
    const definition =
      input.definition === undefined ? undefined : formDefinitionSchema.safeParse(input.definition);
    if (definition && !definition.success) throw new BadRequestException('ساختار قالب معتبر نیست.');
    const updated = await this.prisma.formTemplate.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(definition?.success ? { definition: toJson(definition.data) } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        version: { increment: 1 },
        updatedByUserId: meta.actorUserId,
      },
    });
    await this.audit(this.prisma, {
      action: 'template.updated',
      targetType: 'template',
      targetId: existing.id,
      actorUserId: meta.actorUserId,
      organizationId: existing.organizationId ?? undefined,
      branchId: existing.branchId ?? undefined,
      correlationId: meta.correlationId,
    });
    return updated;
  }

  async getPlatformSettings() {
    const settings = await this.prisma.formPlatformSettings.findUnique({ where: { id: 1 } });
    return {
      defaultTheme: formThemeSchema.parse(settings?.defaultTheme ?? defaultTheme),
      updatedAt: settings?.updatedAt.toISOString() ?? null,
    };
  }

  async updatePlatformSettings(input: { defaultTheme: unknown }, meta: CommandMeta) {
    const theme = formThemeSchema.safeParse(input.defaultTheme);
    if (!theme.success) throw new BadRequestException('تنظیمات ظاهری پیش‌فرض معتبر نیست.');
    const settings = await this.prisma.formPlatformSettings.upsert({
      where: { id: 1 },
      create: { id: 1, defaultTheme: toJson(theme.data), updatedByUserId: meta.actorUserId },
      update: { defaultTheme: toJson(theme.data), updatedByUserId: meta.actorUserId },
    });
    await this.audit(this.prisma, {
      action: 'platform.settings.updated',
      targetType: 'settings',
      targetId: '1',
      actorUserId: meta.actorUserId,
      correlationId: meta.correlationId,
    });
    return { defaultTheme: theme.data, updatedAt: settings.updatedAt.toISOString() };
  }

  private isInAvailabilityWindow(form: { startsAt: Date | null; endsAt: Date | null }): boolean {
    const now = Date.now();
    return (
      (!form.startsAt || form.startsAt.getTime() <= now) &&
      (!form.endsAt || form.endsAt.getTime() > now)
    );
  }

  private async audit(
    client: PrismaService | Prisma.TransactionClient,
    input: {
      action: string;
      targetType: string;
      targetId: string;
      actorUserId?: string;
      organizationId?: string;
      branchId?: string;
      reason?: string;
      correlationId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.formAuditLog.create({
      data: {
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.metadata ? { metadata: toJson(input.metadata) } : {}),
      },
    });
  }

  private async recordEvent(
    tx: Prisma.TransactionClient,
    event: ReturnType<typeof createEventEnvelope>,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: event.eventId,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        aggregateId: event.aggregateId,
        envelope: toJson(event),
      },
    });
  }
}
