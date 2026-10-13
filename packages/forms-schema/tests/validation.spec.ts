import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyFormDefinition,
  formDefinitionSchema,
  nextFlowPage,
  previousFlowPage,
  visibleFlowPages,
  validateFormFieldAnswer,
  validateFormSubmission,
  type FormDefinition,
} from '../src/index.js';

const pageId = '11111111-1111-4111-8111-111111111111';
const firstFieldId = '22222222-2222-4222-8222-222222222222';
const secondFieldId = '33333333-3333-4333-8333-333333333333';
const optionId = '44444444-4444-4444-8444-444444444444';
const startPageId = '66666666-6666-4666-8666-666666666666';
const conditionalPageId = '77777777-7777-4777-8777-777777777777';
const endPageId = '88888888-8888-4888-8888-888888888888';

function form(): FormDefinition {
  return formDefinitionSchema.parse({
    schemaVersion: 1,
    title: 'فرم آزمایشی',
    pages: [
      {
        id: pageId,
        title: 'پرسش‌ها',
        fields: [
          {
            id: firstFieldId,
            type: 'single_choice',
            label: 'انتخاب',
            required: true,
            options: [
              { id: optionId, label: 'بله' },
              { id: '55555555-5555-4555-8555-555555555555', label: 'خیر' },
            ],
          },
          {
            id: secondFieldId,
            type: 'short_text',
            label: 'نام',
            required: true,
            condition: { fieldId: firstFieldId, operator: 'equals', value: optionId },
          },
        ],
      },
    ],
  });
}

test('normalizes legacy v1 definitions into the v2 page model', () => {
  const schema = form();
  assert.equal(schema.schemaVersion, 2);
  assert.equal(schema.pages[0]?.kind, 'questions');
  assert.equal(schema.theme.cardStyle.maxWidth, 'wide');
});

test('creates a blank form with explicit start, question, and end pages', () => {
  const schema = createEmptyFormDefinition('فرم جدید');
  assert.deepEqual(
    schema.pages.map((page) => page.kind),
    ['start', 'questions', 'end'],
  );
  assert.equal(schema.pages[0]?.fields.length, 0);
  assert.equal(schema.pages[2]?.fields.length, 0);
});

test('rejects invalid start/end placement and answer fields on journey pages', () => {
  const schema = createEmptyFormDefinition('فرم جدید');
  const misplacedStart = structuredClone(schema);
  misplacedStart.pages.reverse();
  assert.equal(formDefinitionSchema.safeParse(misplacedStart).success, false);

  const startWithField = structuredClone(schema);
  startWithField.pages[0]!.fields.push({
    id: firstFieldId,
    type: 'short_text',
    label: 'پاسخ',
    description: '',
    helpText: '',
    placeholder: '',
    required: false,
    sensitive: false,
    searchable: false,
    validation: {},
  });
  assert.equal(formDefinitionSchema.safeParse(startWithField).success, false);
});

test('flow navigation skips conditional pages and exposes the end page only after completion', () => {
  const base = createEmptyFormDefinition('فرم شرطی');
  const firstQuestion = {
    ...base.pages[1]!,
    fields: [
      {
        id: firstFieldId,
        type: 'short_text' as const,
        label: 'پاسخ',
        description: '',
        helpText: '',
        placeholder: '',
        required: false,
        sensitive: false,
        searchable: false,
        validation: {},
      },
    ],
  };
  const conditionalPage = {
    id: conditionalPageId,
    kind: 'questions' as const,
    title: 'صفحه شرطی',
    description: '',
    condition: { fieldId: firstFieldId, operator: 'equals' as const, value: 'show' },
    fields: [],
  };
  const definition = formDefinitionSchema.parse({
    ...base,
    pages: [
      { ...base.pages[0]!, id: startPageId },
      firstQuestion,
      conditionalPage,
      { ...base.pages[2]!, id: endPageId },
    ],
  });

  const start = definition.pages[0]!;
  const first = definition.pages[1]!;
  assert.equal(nextFlowPage(definition, {}, start.id)?.id, first.id);
  assert.equal(nextFlowPage(definition, { [firstFieldId]: 'hide' }, first.id), undefined);
  assert.equal(
    nextFlowPage(definition, { [firstFieldId]: 'show' }, first.id)?.id,
    conditionalPageId,
  );
  assert.equal(
    previousFlowPage(definition, { [firstFieldId]: 'show' }, conditionalPageId)?.id,
    first.id,
  );
  assert.deepEqual(
    visibleFlowPages(definition, {}, true).map((page) => page.kind),
    ['end'],
  );
  assert.equal(
    visibleFlowPages(definition, {}).some((page) => page.kind === 'end'),
    false,
  );
});

test('rejects a condition that points to a later field', () => {
  const schema = form();
  const invalid = structuredClone(schema);
  invalid.pages[0]!.fields[0]!.condition = { fieldId: secondFieldId, operator: 'answered' };
  assert.equal(formDefinitionSchema.safeParse(invalid).success, false);
});

test('validates visible required answers and ignores answers on hidden fields', () => {
  const schema = form();
  const missing = validateFormSubmission(schema, { [firstFieldId]: optionId });
  assert.equal(missing.success, false);
  if (!missing.success) assert.equal(missing.issues[0]?.fieldId, secondFieldId);

  const hidden = validateFormSubmission(schema, {
    [firstFieldId]: '55555555-5555-4555-8555-555555555555',
    [secondFieldId]: '<unsafe>',
  });
  assert.deepEqual(hidden, {
    success: true,
    answers: { [firstFieldId]: '55555555-5555-4555-8555-555555555555' },
  });
});

test('uses allow-listed link values instead of submitted hidden field values', () => {
  const schema = formDefinitionSchema.parse({
    schemaVersion: 1,
    title: 'فرم',
    pages: [
      {
        id: pageId,
        title: 'صفحه',
        fields: [{ id: firstFieldId, type: 'hidden', label: 'منبع', prefillKey: 'source' }],
      },
    ],
  });
  const result = validateFormSubmission(
    schema,
    { [firstFieldId]: 'forged' },
    { source: 'campaign-a' },
  );
  assert.deepEqual(result, { success: true, answers: { [firstFieldId]: 'campaign-a' } });
});

test('rejects an unknown field in submitted answers', () => {
  const result = validateFormSubmission(form(), { unknown: 'value' });
  assert.equal(result.success, false);
});

test('normalizes a single answer with the same rules used by full submissions', () => {
  const field = { ...form().pages[0]!.fields[1]!, validation: { maxLength: 4 } };
  assert.deepEqual(validateFormFieldAnswer(field, '  Ada\u0000  '), {
    success: true,
    value: 'Ada',
  });
  assert.equal(validateFormFieldAnswer(field, 'x'.repeat(5)).success, false);
});
