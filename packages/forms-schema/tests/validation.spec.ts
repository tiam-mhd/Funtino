import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formDefinitionSchema,
  validateFormFieldAnswer,
  validateFormSubmission,
  type FormDefinition,
} from '../src/index.js';

const pageId = '11111111-1111-4111-8111-111111111111';
const firstFieldId = '22222222-2222-4222-8222-222222222222';
const secondFieldId = '33333333-3333-4333-8333-333333333333';
const optionId = '44444444-4444-4444-8444-444444444444';

function form(): FormDefinition {
  return formDefinitionSchema.parse({
    schemaVersion: 1,
    title: 'فرم آزمایشی',
    pages: [
      {
        id: pageId,
        title: 'پرسش‌ها',
        fields: [
          { id: firstFieldId, type: 'single_choice', label: 'انتخاب', required: true, options: [{ id: optionId, label: 'بله' }, { id: '55555555-5555-4555-8555-555555555555', label: 'خیر' }] },
          { id: secondFieldId, type: 'short_text', label: 'نام', required: true, condition: { fieldId: firstFieldId, operator: 'equals', value: optionId } },
        ],
      },
    ],
  });
}

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

  const hidden = validateFormSubmission(schema, { [firstFieldId]: '55555555-5555-4555-8555-555555555555', [secondFieldId]: '<unsafe>' });
  assert.deepEqual(hidden, { success: true, answers: { [firstFieldId]: '55555555-5555-4555-8555-555555555555' } });
});

test('uses allow-listed link values instead of submitted hidden field values', () => {
  const schema = formDefinitionSchema.parse({
    schemaVersion: 1,
    title: 'فرم',
    pages: [{ id: pageId, title: 'صفحه', fields: [{ id: firstFieldId, type: 'hidden', label: 'منبع', prefillKey: 'source' }] }],
  });
  const result = validateFormSubmission(schema, { [firstFieldId]: 'forged' }, { source: 'campaign-a' });
  assert.deepEqual(result, { success: true, answers: { [firstFieldId]: 'campaign-a' } });
});

test('rejects an unknown field in submitted answers', () => {
  const result = validateFormSubmission(form(), { unknown: 'value' });
  assert.equal(result.success, false);
});

test('normalizes a single answer with the same rules used by full submissions', () => {
  const field = { ...form().pages[0]!.fields[1]!, validation: { maxLength: 4 } };
  assert.deepEqual(validateFormFieldAnswer(field, '  Ada\u0000  '), { success: true, value: 'Ada' });
  assert.equal(validateFormFieldAnswer(field, 'x'.repeat(5)).success, false);
});
