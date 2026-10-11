import { z } from 'zod';

export const FORM_SCHEMA_VERSION = 1 as const;

export const formFieldTypes = [
  'short_text',
  'long_text',
  'full_name',
  'phone',
  'email',
  'number',
  'money',
  'date',
  'time',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'yes_no',
  'rating',
  'nps',
  'slider',
  'ranking',
  'matrix',
  'consent',
  'heading',
  'paragraph',
  'hidden',
] as const;

export const formConditionSchema = z
  .object({
    fieldId: z.string().uuid(),
    operator: z.enum(['answered', 'equals', 'not_equals', 'contains', 'greater_than', 'less_than']),
    value: z.unknown().optional(),
  })
  .strict()
  .superRefine((condition, context) => {
    if (condition.operator !== 'answered' && condition.value === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Condition value is required.' });
    }
  });

const optionSchema = z
  .object({ id: z.string().uuid(), label: z.string().trim().min(1).max(120) })
  .strict();

const validationSchema = z
  .object({
    minLength: z.number().int().min(0).max(4000).optional(),
    maxLength: z.number().int().min(1).max(4000).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    errorMessage: z.string().trim().max(240).optional(),
  })
  .strict()
  .refine((value) => value.minLength === undefined || value.maxLength === undefined || value.minLength <= value.maxLength)
  .refine((value) => value.min === undefined || value.max === undefined || value.min <= value.max);

const fieldSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(formFieldTypes),
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).default(''),
    helpText: z.string().trim().max(500).default(''),
    placeholder: z.string().max(160).default(''),
    required: z.boolean().default(false),
    sensitive: z.boolean().default(false),
    searchable: z.boolean().default(false),
    defaultValue: z.unknown().optional(),
    options: z.array(optionSchema).max(50).optional(),
    rows: z.array(optionSchema).max(30).optional(),
    validation: validationSchema.default({}),
    condition: formConditionSchema.optional(),
    prefillKey: z.enum(['source', 'campaign', 'ref']).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (['single_choice', 'multiple_choice', 'dropdown', 'ranking'].includes(field.type) && (field.options?.length ?? 0) < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'At least two options are required.' });
    }
    if (field.type === 'matrix' && ((field.options?.length ?? 0) < 2 || (field.rows?.length ?? 0) < 1)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rows'], message: 'A matrix requires rows and at least two columns.' });
    }
    if (field.type === 'hidden' && !field.prefillKey) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['prefillKey'], message: 'Hidden fields require an allow-listed link parameter.' });
    }
    if (field.type !== 'hidden' && field.prefillKey) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['prefillKey'], message: 'Only hidden fields may use link parameters.' });
    }
    if (field.type === 'rating' && field.validation.max !== undefined && ![5, 10].includes(field.validation.max)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['validation', 'max'], message: 'Rating scale must be 5 or 10.' });
    }
    if (['full_name', 'phone', 'email'].includes(field.type) && !field.sensitive) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['sensitive'], message: 'Identity fields must use the separate PII permission.' });
    }
    if (field.searchable && (field.sensitive || !['short_text', 'long_text', 'full_name', 'phone', 'email'].includes(field.type))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['searchable'], message: 'Only non-sensitive text fields can be searchable.' });
    }
  });

const pageSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).default(''),
    condition: formConditionSchema.optional(),
    fields: z.array(fieldSchema).max(100),
  })
  .strict();

export const formThemeSchema = z
  .object({
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#12a89d'),
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#f2a13a'),
    backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#f3f7f8'),
    surfaceColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#ffffff'),
    font: z.enum(['vazirmatn', 'estedad']).default('estedad'),
    cornerStyle: z.enum(['soft', 'rounded', 'pill']).default('rounded'),
    layout: z.enum(['paged', 'single']).default('paged'),
    showProgress: z.boolean().default(true),
  })
  .strict();

export const formDefinitionSchema = z
  .object({
    schemaVersion: z.literal(FORM_SCHEMA_VERSION),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1500).default(''),
    welcomeTitle: z.string().trim().max(160).default(''),
    welcomeMessage: z.string().trim().max(1000).default(''),
    successMessage: z.string().trim().max(1000).default('پاسخت ثبت شد. از همراهی‌ات ممنونیم.'),
    pages: z.array(pageSchema).min(1).max(20),
    theme: formThemeSchema.default({}),
  })
  .strict()
  .superRefine((definition, context) => {
    const pageIds = new Set<string>();
    const fieldIds = new Set<string>();
    const precedingFields = new Set<string>();
    let totalFields = 0;

    const checkCondition = (condition: z.infer<typeof formConditionSchema> | undefined, path: (string | number)[]) => {
      if (condition && !precedingFields.has(condition.fieldId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path, message: 'Conditions may only reference an earlier field.' });
      }
    };

    definition.pages.forEach((page, pageIndex) => {
      if (pageIds.has(page.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', pageIndex, 'id'], message: 'Page identifiers must be unique.' });
      }
      pageIds.add(page.id);
      checkCondition(page.condition, ['pages', pageIndex, 'condition']);
      page.fields.forEach((field, fieldIndex) => {
        totalFields += 1;
        if (fieldIds.has(field.id)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', pageIndex, 'fields', fieldIndex, 'id'], message: 'Field identifiers must be unique.' });
        }
        fieldIds.add(field.id);
        checkCondition(field.condition, ['pages', pageIndex, 'fields', fieldIndex, 'condition']);
        const optionIds = [...(field.options ?? []), ...(field.rows ?? [])].map(({ id }) => id);
        if (new Set(optionIds).size !== optionIds.length) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', pageIndex, 'fields', fieldIndex], message: 'Option and row identifiers must be unique within a field.' });
        }
        precedingFields.add(field.id);
      });
    });

    if (totalFields > 100) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: 'A form may contain at most 100 fields.' });
    }
  });

export const formAccessSchema = z.enum(['guest', 'optional_auth', 'auth_required']);
export const formStatusSchema = z.enum(['draft', 'published', 'paused', 'archived']);
export const responseStatusSchema = z.enum(['new', 'in_review', 'followed_up', 'closed', 'spam']);

export type FormFieldType = (typeof formFieldTypes)[number];
export type FormCondition = z.infer<typeof formConditionSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormField = FormDefinition['pages'][number]['fields'][number];
export type FormPage = FormDefinition['pages'][number];
export type FormTheme = z.infer<typeof formThemeSchema>;
export type FormAccess = z.infer<typeof formAccessSchema>;
export type FormStatus = z.infer<typeof formStatusSchema>;
export type ResponseStatus = z.infer<typeof responseStatusSchema>;
export type FormAnswers = Record<string, unknown>;
export type FormValidationIssue = { fieldId: string; message: string };
export type FormValidationResult =
  | { success: true; answers: FormAnswers }
  | { success: false; issues: FormValidationIssue[] };

export function evaluateCondition(condition: FormCondition | undefined, answers: FormAnswers): boolean {
  if (!condition) return true;
  const actual = answers[condition.fieldId];
  const answered = actual !== undefined && actual !== null && actual !== '' && !(Array.isArray(actual) && actual.length === 0);
  if (condition.operator === 'answered') return answered;
  if (!answered) return false;
  if (condition.operator === 'equals') return JSON.stringify(actual) === JSON.stringify(condition.value);
  if (condition.operator === 'not_equals') return JSON.stringify(actual) !== JSON.stringify(condition.value);
  if (condition.operator === 'contains') {
    return Array.isArray(actual)
      ? actual.some((value) => JSON.stringify(value) === JSON.stringify(condition.value))
      : typeof actual === 'string' && actual.includes(String(condition.value ?? ''));
  }
  if (typeof actual !== 'number' || typeof condition.value !== 'number') return false;
  return condition.operator === 'greater_than' ? actual > condition.value : actual < condition.value;
}

export function visiblePages(definition: FormDefinition, answers: FormAnswers): FormPage[] {
  return definition.pages.filter((page) => evaluateCondition(page.condition, answers));
}

export function visibleFields(page: FormPage, answers: FormAnswers): FormField[] {
  return page.fields.filter(
    (field) => field.type !== 'hidden' && field.type !== 'heading' && field.type !== 'paragraph' && evaluateCondition(field.condition, answers),
  );
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').slice(0, 4000);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function validateValue(field: FormField, value: unknown): string | null {
  if (isEmpty(value)) return field.required ? 'پاسخ به این پرسش الزامی است.' : null;
  const validation = field.validation;
  const invalid = validation.errorMessage || 'پاسخ واردشده معتبر نیست.';
  if (['short_text', 'long_text', 'full_name', 'phone', 'email'].includes(field.type)) {
    if (typeof value !== 'string') return invalid;
    const text = value as string;
    if (text.length < (validation.minLength ?? 0) || text.length > (validation.maxLength ?? 4000)) return invalid;
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text)) return invalid;
    if (field.type === 'phone' && !/^\+?[1-9]\d{7,14}$/u.test(text.replace(/[\s()-]/gu, ''))) return invalid;
    return null;
  }
  if (['number', 'money', 'slider'].includes(field.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return invalid;
    if (validation.min !== undefined && value < validation.min) return invalid;
    if (validation.max !== undefined && value > validation.max) return invalid;
    return null;
  }
  if (field.type === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return invalid;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid;
  }
  if (field.type === 'time' && (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value))) return invalid;
  if (['single_choice', 'dropdown'].includes(field.type)) {
    return typeof value === 'string' && field.options?.some((option) => option.id === value) ? null : invalid;
  }
  if (field.type === 'multiple_choice') {
    return Array.isArray(value) && new Set(value).size === value.length && value.every((id) => typeof id === 'string' && field.options?.some((option) => option.id === id)) ? null : invalid;
  }
  if (field.type === 'yes_no' || field.type === 'consent') return typeof value === 'boolean' ? null : invalid;
  if (field.type === 'rating') return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= (validation.max ?? 5) ? null : invalid;
  if (field.type === 'nps') return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ? null : invalid;
  if (field.type === 'ranking') {
    const expected = new Set((field.options ?? []).map((option) => option.id));
    return Array.isArray(value) && value.length === expected.size && new Set(value).size === expected.size && value.every((id) => expected.has(String(id))) ? null : invalid;
  }
  if (field.type === 'matrix') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid;
    const answers = value as Record<string, unknown>;
    const rows = field.rows ?? [];
    const options = new Set((field.options ?? []).map((option) => option.id));
    return rows.every((row) => typeof answers[row.id] === 'string' && options.has(answers[row.id] as string)) && Object.keys(answers).every((id) => rows.some((row) => row.id === id)) ? null : invalid;
  }
  return null;
}

export function validateFormFieldAnswer(field: FormField, input: unknown):
  | { success: true; value: unknown }
  | { success: false; issue: FormValidationIssue } {
  let value = input;
  if (typeof value === 'string') value = cleanText(value).trim();
  if (Array.isArray(value)) value = value.map((item) => (typeof item === 'string' ? cleanText(item) : item));
  const message = validateValue(field, value);
  return message
    ? { success: false, issue: { fieldId: field.id, message } }
    : { success: true, value };
}

export function validateFormSubmission(
  inputDefinition: unknown,
  inputAnswers: unknown,
  linkParameters: Record<string, string | undefined> = {},
): FormValidationResult {
  const parsed = formDefinitionSchema.safeParse(inputDefinition);
  if (!parsed.success || !inputAnswers || typeof inputAnswers !== 'object' || Array.isArray(inputAnswers)) {
    return { success: false, issues: [{ fieldId: 'form', message: 'ساختار فرم یا پاسخ معتبر نیست.' }] };
  }
  const definition = parsed.data;
  const submitted = inputAnswers as Record<string, unknown>;
  const knownIds = new Set(definition.pages.flatMap((page) => page.fields.map((field) => field.id)));
  if (Object.keys(submitted).some((key) => !knownIds.has(key))) {
    return { success: false, issues: [{ fieldId: 'form', message: 'پاسخ شامل فیلد ناشناخته است.' }] };
  }

  const answers: FormAnswers = {};
  const issues: FormValidationIssue[] = [];
  for (const page of definition.pages) {
    if (!evaluateCondition(page.condition, answers)) continue;
    for (const field of page.fields) {
      if (!evaluateCondition(field.condition, answers)) continue;
      if (field.type === 'heading' || field.type === 'paragraph') continue;
      let value = submitted[field.id];
      if (field.type === 'hidden') {
        value = field.prefillKey ? linkParameters[field.prefillKey] : undefined;
        if (typeof value === 'string') value = cleanText(value.slice(0, 160));
        if (typeof value === 'string' && value.length > 0) answers[field.id] = value;
        continue;
      }
      if (isEmpty(value) && field.defaultValue !== undefined) value = field.defaultValue;
      const validated = validateFormFieldAnswer(field, value);
      if (!validated.success) {
        issues.push(validated.issue);
        continue;
      }
      if (!isEmpty(validated.value)) answers[field.id] = validated.value;
    }
  }
  return issues.length ? { success: false, issues } : { success: true, answers };
}
