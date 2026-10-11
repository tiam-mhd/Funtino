import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@funtino/backend-core';
import type { AuthenticatedRequest } from '../interfaces/http/current-user.decorator.js';
import { CustomerFormsController } from '../interfaces/http/customer-forms.controller.js';
import { OperationsFormsController } from '../interfaces/http/operations-forms.controller.js';
import type { FormsClient } from '../infrastructure/forms/forms.client.js';
import type { IdentityAccessClient } from '../infrastructure/identity-access/identity-access.client.js';
import type { OrganizationBranchClient } from '../infrastructure/organization-branch/organization-branch.client.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const otherBranchId = '44444444-4444-4444-8444-444444444444';
const correlationId = '55555555-5555-4555-8555-555555555555';
const nonSensitiveFieldId = '66666666-6666-4666-8666-666666666666';
const sensitiveFieldId = '77777777-7777-4777-8777-777777777777';
const pageId = '88888888-8888-4888-8888-888888888888';
const responseId = '99999999-9999-4999-8999-999999999999';

const correctionDefinition = {
  schemaVersion: 1,
  title: 'Contact form',
  pages: [{
    id: pageId,
    title: 'Contact',
    fields: [
      { id: nonSensitiveFieldId, type: 'short_text', label: 'Message' },
      { id: sensitiveFieldId, type: 'email', label: 'Email', sensitive: true },
    ],
  }],
};

function request(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    session: { id: 'session-id', userId, isSystemAdmin: false } as never,
    requestId: 'request-id',
    correlationId,
    ...overrides,
  } as AuthenticatedRequest;
}

test('guest and signed-in customer submissions only link an account after explicit consent', async () => {
  const forwarded: Array<{ path: string; body: Record<string, unknown> }> = [];
  const forms = {
    request: async (path: string, options: { body?: Record<string, unknown> }) => {
      forwarded.push({ path, body: options.body ?? {} });
      return { status: 'submitted' };
    },
  } as unknown as FormsClient;
  const controller = new CustomerFormsController(forms);

  await controller.submit('public-form', {
    answers: {},
    idempotencyKey: 'guest-idempotency-key',
    linkToAccountConsent: false,
  }, request({ session: undefined }));

  await controller.submit('public-form', {
    answers: {},
    idempotencyKey: 'signed-in-no-consent-key',
    linkToAccountConsent: false,
  }, request({ user: { id: userId } as never }));

  await controller.submit('public-form', {
    answers: {},
    idempotencyKey: 'signed-in-idempotency-key',
    linkToAccountConsent: true,
    linkParameters: { source: 'branch-card' },
  }, request({ user: { id: userId } as never }));

  assert.equal(forwarded[0]?.body.isAuthenticated, false);
  assert.equal('customerId' in (forwarded[0]?.body ?? {}), false);
  assert.equal(forwarded[1]?.body.isAuthenticated, true);
  assert.equal('customerId' in (forwarded[1]?.body ?? {}), false);
  assert.equal(forwarded[2]?.body.isAuthenticated, true);
  assert.equal(forwarded[2]?.body.customerId, userId);
  assert.deepEqual(forwarded[2]?.body.linkParameters, { source: 'branch-card' });
});

test('branch-scoped form list forwards the selected scope to IAM and stops before the owner service on denial', async () => {
  let authorization: unknown;
  let formsCalls = 0;
  const controller = new OperationsFormsController(
    {
      evaluateAuthorization: async (...args: unknown[]) => {
        authorization = args[2];
        return { allowed: false, reason: 'scope_denied' };
      },
    } as unknown as IdentityAccessClient,
    {} as OrganizationBranchClient,
    { request: async () => { formsCalls += 1; return { items: [] }; } } as unknown as FormsClient,
  );

  await assert.rejects(
    controller.list(
      { id: userId },
      { scopeType: 'branch', organizationId, branchId: otherBranchId, pageSize: 25 },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.deepEqual(authorization, {
    permission: 'forms.read',
    scope: { type: 'branch', organizationId, branchId: otherBranchId },
  });
  assert.equal(formsCalls, 0);
});

test('organization aggregate returns scoped counts without forwarding response content', async () => {
  const forwarded: Array<{ path: string; query?: Record<string, unknown> }> = [];
  const controller = new OperationsFormsController(
    {
      evaluateAuthorization: async () => ({ allowed: true, reason: 'allowed' }),
    } as unknown as IdentityAccessClient,
    { getOrganization: async () => ({ status: 'active' }) } as unknown as OrganizationBranchClient,
    {
      request: async (path: string, options: { query?: Record<string, unknown> }) => {
        forwarded.push({ path, query: options.query });
        return { total: 2, byStatus: { new: 2 }, byBranch: [{ branchId, count: 2 }] };
      },
    } as unknown as FormsClient,
  );

  const result = await controller.aggregateResponseStats(
    { id: userId },
    { scopeType: 'organization', organizationId },
    request(),
  );

  assert.deepEqual(forwarded, [{ path: '/internal/v1/forms/responses/stats', query: { organizationId } }]);
  assert.deepEqual(result.data, { total: 2, byStatus: { new: 2 }, byBranch: [{ branchId, count: 2 }] });
  assert.equal(JSON.stringify(result).includes('answers'), false);
});

test('response correction requires the separate MFA protected PII permission for sensitive fields', async () => {
  const calls: string[] = [];
  const controller = new OperationsFormsController(
    {
      evaluateAuthorization: async (_userId: unknown, _session: unknown, input: { permission: string }) => {
        if (input.permission === 'forms.responses.pii.read') return { allowed: false, reason: 'step_up_required' };
        return { allowed: true, reason: 'allowed' };
      },
    } as unknown as IdentityAccessClient,
    {
      getOrganization: async () => ({ status: 'active' }),
      getOrganizationBranch: async () => ({ organizationId, status: 'active' }),
    } as unknown as OrganizationBranchClient,
    {
      request: async (path: string) => {
        calls.push(path);
        if (path.endsWith(`/${responseId}`)) return { definition: correctionDefinition, correctionVersion: 0 };
        return { correctionVersion: 1 };
      },
    } as unknown as FormsClient,
  );

  await assert.rejects(
    controller.correctResponse(
      { id: userId },
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      responseId,
      { organizationId, branchId, expectedVersion: 0, changes: [{ fieldId: sensitiveFieldId, value: 'person@example.test' }], reason: 'Corrected contact detail' },
      request(),
    ),
    (error: unknown) => error instanceof DomainError && error.code === 'FORBIDDEN',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.endsWith('/answers'), false);
});

test('response correction forwards non-sensitive changes with the expected version and reason', async () => {
  const calls: Array<{ path: string; options: { method?: string; body?: Record<string, unknown> } }> = [];
  const controller = new OperationsFormsController(
    { evaluateAuthorization: async () => ({ allowed: true, reason: 'allowed' }) } as unknown as IdentityAccessClient,
    {
      getOrganization: async () => ({ status: 'active' }),
      getOrganizationBranch: async () => ({ organizationId, status: 'active' }),
    } as unknown as OrganizationBranchClient,
    {
      request: async (path: string, options: { method?: string; body?: Record<string, unknown> }) => {
        calls.push({ path, options });
        if (path.endsWith(`/${responseId}`)) return { definition: correctionDefinition, correctionVersion: 0 };
        return { id: responseId, correctionVersion: 1, changedFieldCount: 1 };
      },
    } as unknown as FormsClient,
  );

  const result = await controller.correctResponse(
    { id: userId },
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    responseId,
    { organizationId, branchId, expectedVersion: 0, changes: [{ fieldId: nonSensitiveFieldId, value: 'Updated message' }], reason: 'Corrected message' },
    request(),
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.options.method, 'PATCH');
  assert.deepEqual(calls[1]?.options.body, {
    organizationId,
    branchId,
    expectedVersion: 0,
    changes: [{ fieldId: nonSensitiveFieldId, value: 'Updated message' }],
    reason: 'Corrected message',
    actorUserId: userId,
    correlationId,
  });
  assert.deepEqual(result.data, { id: responseId, correctionVersion: 1, changedFieldCount: 1 });
});
