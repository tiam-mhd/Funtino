import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyFormDefinition, formDefinitionSchema } from '@funtino/forms-schema';
import {
  changeOperationsFormState,
  createOperationsForm,
  getOperationsForms,
  saveOperationsFormDraft,
} from '../lib/api/operations-forms';

const organizationId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const formId = '33333333-3333-4333-8333-333333333333';

async function withFetchStub<T>(
  stub: (input: RequestInfo | URL, init?: RequestInit) => Response,
  run: () => Promise<T>,
) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => stub(input, init)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function successResponse(data: unknown) {
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const scope = { type: 'branch' as const, organizationId, branchId };
const definition = createEmptyFormDefinition('ثبت‌نام کارگاه نقاشی');
test('form library sends the selected scope, query, status, and cursor to the existing list API', async () => {
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/v1/operations/forms');
      assert.equal(url.searchParams.get('scopeType'), 'branch');
      assert.equal(url.searchParams.get('organizationId'), organizationId);
      assert.equal(url.searchParams.get('branchId'), branchId);
      assert.equal(url.searchParams.get('query'), 'کارگاه');
      assert.equal(url.searchParams.get('status'), 'published');
      assert.equal(url.searchParams.get('cursor'), formId);
      assert.equal(url.searchParams.get('pageSize'), '50');
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.cache, 'no-store');
      return successResponse({ items: [], nextCursor: null });
    },
    async () => {
      const page = await getOperationsForms(scope, {
        query: 'کارگاه',
        status: 'published',
        cursor: formId,
        pageSize: 50,
      });
      assert.equal(page.items.length, 0);
      assert.equal(page.nextCursor, null);
    },
  );
});

test('creating a form, saving its draft, and publishing use the existing scoped operations endpoints', async () => {
  const paths: string[] = [];
  await withFetchStub(
    (input, init) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === '/api/v1/operations/forms' && init?.method === 'POST') {
        assert.deepEqual(JSON.parse(String(init.body)), {
          organizationId,
          branchId,
          title: definition.title,
        });
        return successResponse({ id: formId });
      }
      if (url.pathname === `/api/v1/operations/forms/${formId}/draft`) {
        assert.equal(init?.method, 'PUT');
        assert.deepEqual(JSON.parse(String(init.body)), { organizationId, branchId, definition });
        return successResponse({ id: formId, draftSchema: definition });
      }
      if (url.pathname === `/api/v1/operations/forms/${formId}/publish`) {
        assert.equal(init?.method, 'POST');
        assert.deepEqual(JSON.parse(String(init.body)), {
          organizationId,
          branchId,
          reason: 'آماده‌ی انتشار است',
        });
        return successResponse({ id: formId, status: 'published', currentVersion: 1 });
      }
      assert.fail(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    },
    async () => {
      await createOperationsForm({ organizationId, branchId, title: definition.title });
      await saveOperationsFormDraft(formId, scope, definition);
      await changeOperationsFormState(formId, scope, 'publish', 'آماده‌ی انتشار است');
    },
  );
  assert.deepEqual(paths, [
    '/api/v1/operations/forms',
    `/api/v1/operations/forms/${formId}/draft`,
    `/api/v1/operations/forms/${formId}/publish`,
  ]);
});

test('definition validation rejects a choice question that is incomplete before publish', () => {
  const invalidDefinition = {
    ...definition,
    pages: definition.pages.map((page) =>
      page.kind === 'questions'
        ? {
            ...page,
            fields: [
              {
                id: '55555555-5555-4555-8555-555555555555',
                type: 'single_choice',
                label: 'کدام زمان مناسب است؟',
                description: '',
                helpText: '',
                placeholder: '',
                required: true,
                sensitive: false,
                searchable: false,
                options: [{ id: '66666666-6666-4666-8666-666666666666', label: 'صبح' }],
                validation: {},
              },
            ],
          }
        : page,
    ),
  };
  const result = formDefinitionSchema.safeParse(invalidDefinition);
  assert.equal(result.success, false);
  if (!result.success) assert(result.error.issues.some((issue) => issue.path.at(-1) === 'options'));
});
