import { apiRequest } from './client';
import type { OperationsScope } from '../auth/operations-access';
import type {
  FormAnswers,
  FormDefinition,
  FormStatus,
  ResponseStatus,
} from '@funtino/forms-schema';

export type OperationsForm = {
  id: string;
  organizationId: string;
  branchId: string;
  slug: string;
  title: string;
  description: string;
  status: FormStatus;
  accessMode: 'guest' | 'optional_auth' | 'auth_required';
  linkEnabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  responseLimit: number | null;
  responseCount: number;
  currentVersion: number | null;
  draftSchema?: FormDefinition;
  publishedDefinition?: FormDefinition | null;
  createdAt: string;
  publishedAt: string | null;
};

export type OperationsFormResponse = {
  id: string;
  organizationId: string;
  branchId: string;
  formId: string;
  formVersionId: string;
  status: ResponseStatus;
  submittedAt: string;
  correctionVersion: number;
  customerLinked: boolean;
  hasSensitive: boolean;
  tags: string[];
};

export type OperationsFormResponseDetail = OperationsFormResponse & {
  answers: FormAnswers;
  definition: FormDefinition;
  notes: Array<{ id: string; authorUserId: string; body: string; createdAt: string }>;
  corrections: Array<{
    id: string;
    fieldId: string;
    correctionVersion: number;
    previousPresent: boolean;
    previousValue: unknown;
    newPresent: boolean;
    newValue: unknown;
    redacted: boolean;
    reason: string;
    actorUserId: string;
    createdAt: string;
  }>;
};

export type OperationsFormTemplate = {
  id: string;
  scopeType: 'global' | 'organization' | 'branch';
  organizationId: string | null;
  branchId: string | null;
  name: string;
  description: string;
  definition: FormDefinition;
  enabled: boolean;
  version: number;
};

export type OperationsFormsCapabilities = {
  canRead: boolean;
  canManage: boolean;
  canPublish: boolean;
  canReadResponses: boolean;
  canManageResponses: boolean;
  canCorrectResponses: boolean;
  correctionStepUpRequired: boolean;
  canReadSensitiveResponses: boolean;
  canExportResponses: boolean;
  exportStepUpRequired: boolean;
  canManageTemplates: boolean;
};

export type OperationsFormsPage<T> = { items: T[]; nextCursor: string | null };
export type OperationsFormResponseStats = {
  total: number;
  byStatus: Partial<Record<ResponseStatus, number>>;
  byBranch: Array<{ branchId: string; count: number }>;
};

function scopeQuery(scope: OperationsScope): URLSearchParams {
  const query = new URLSearchParams({
    scopeType: scope.type,
    organizationId: scope.organizationId,
  });
  if (scope.type === 'branch') query.set('branchId', scope.branchId);
  return query;
}

function formPath(scope: OperationsScope, formId?: string): string {
  const path = `/api/v1/operations/forms${formId ? `/${encodeURIComponent(formId)}` : ''}`;
  return `${path}?${scopeQuery(scope).toString()}`;
}

export function getOperationsForms(
  scope: OperationsScope,
  filters: { status?: FormStatus; query?: string; cursor?: string; pageSize?: number } = {},
) {
  const query = scopeQuery(scope);
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== '') query.set(key, String(value));
  return apiRequest<OperationsFormsPage<OperationsForm>>(
    `/api/v1/operations/forms?${query.toString()}`,
  );
}

export function getOperationsFormsCapabilities(scope: OperationsScope) {
  return apiRequest<OperationsFormsCapabilities>(
    `/api/v1/operations/forms/capabilities?${scopeQuery(scope).toString()}`,
  );
}

export function createOperationsForm(input: {
  organizationId: string;
  branchId: string;
  title: string;
}) {
  return apiRequest<OperationsForm>('/api/v1/operations/forms', { method: 'POST', body: input });
}

export function getOperationsForm(formId: string, scope: OperationsScope) {
  return apiRequest<OperationsForm>(formPath(scope, formId));
}

export function duplicateOperationsForm(formId: string, scope: OperationsScope) {
  return apiRequest<OperationsForm>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/duplicate`,
    {
      method: 'POST',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
      },
    },
  );
}

export function saveOperationsFormDraft(
  formId: string,
  scope: OperationsScope,
  definition: FormDefinition,
) {
  return apiRequest<OperationsForm>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/draft`,
    {
      method: 'PUT',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
        definition,
      },
    },
  );
}

export function saveOperationsFormSettings(
  formId: string,
  scope: OperationsScope,
  input: {
    accessMode: OperationsForm['accessMode'];
    linkEnabled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    responseLimit: number | null;
  },
) {
  return apiRequest<OperationsForm>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/settings`,
    {
      method: 'PUT',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
        ...input,
      },
    },
  );
}

export function changeOperationsFormState(
  formId: string,
  scope: OperationsScope,
  action: 'publish' | 'pause' | 'archive',
  reason?: string,
) {
  return apiRequest<OperationsForm>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/${action}`,
    {
      method: 'POST',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
        ...(reason ? { reason } : {}),
      },
    },
  );
}

export function getOperationsFormResponses(
  formId: string,
  scope: OperationsScope,
  filters: {
    status?: ResponseStatus;
    from?: string;
    to?: string;
    searchFieldId?: string;
    search?: string;
    cursor?: string;
    pageSize?: number;
  },
) {
  const query = scopeQuery(scope);
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== '') query.set(key, String(value));
  return apiRequest<OperationsFormsPage<OperationsFormResponse>>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/responses?${query.toString()}`,
  );
}

export function getOperationsFormResponseStats(formId: string, scope: OperationsScope) {
  return apiRequest<OperationsFormResponseStats>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/responses/stats?${scopeQuery(scope).toString()}`,
  );
}

export function getOperationsFormAggregateStats(scope: OperationsScope) {
  return apiRequest<OperationsFormResponseStats>(
    `/api/v1/operations/forms/responses/stats?${scopeQuery(scope).toString()}`,
  );
}

export function getOperationsFormResponse(
  formId: string,
  responseId: string,
  scope: OperationsScope,
  includeSensitive = false,
) {
  const query = scopeQuery(scope);
  query.set('includeSensitive', String(includeSensitive));
  return apiRequest<OperationsFormResponseDetail>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}?${query.toString()}`,
  );
}

export function updateOperationsResponseStatus(
  formId: string,
  responseId: string,
  scope: OperationsScope,
  status: ResponseStatus,
  reason?: string,
) {
  return apiRequest<OperationsFormResponse>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}/status`,
    {
      method: 'PATCH',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
        status,
        ...(reason ? { reason } : {}),
      },
    },
  );
}

export function correctOperationsFormResponse(
  formId: string,
  responseId: string,
  scope: OperationsScope,
  input: {
    expectedVersion: number;
    changes: Array<{ fieldId: string; value: unknown }>;
    reason: string;
  },
) {
  return apiRequest<{ id: string; correctionVersion: number; changedFieldCount: number }>(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}/answers`,
    {
      method: 'PATCH',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
        ...input,
      },
    },
  );
}

export function addOperationsResponseNote(
  formId: string,
  responseId: string,
  scope: OperationsScope,
  body: string,
) {
  return apiRequest(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}/notes`,
    {
      method: 'POST',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
        body,
      },
    },
  );
}

export function updateOperationsResponseTags(
  formId: string,
  responseId: string,
  scope: OperationsScope,
  tags: string[],
) {
  return apiRequest(
    `/api/v1/operations/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}/tags`,
    {
      method: 'PUT',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
        tags,
      },
    },
  );
}

export function exportOperationsFormResponses(
  formId: string,
  scope: OperationsScope,
  filters: {
    status?: ResponseStatus;
    from?: string;
    to?: string;
    includeSensitive?: boolean;
  },
) {
  const query = scopeQuery(scope);
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== '') query.set(key, String(value));
  return apiRequest<{
    filename: string;
    content: string;
    exportedCount: number;
    truncated: boolean;
  }>(`/api/v1/operations/forms/${encodeURIComponent(formId)}/responses/export?${query.toString()}`);
}

export function getOperationsFormTemplates(scope: OperationsScope) {
  const query = new URLSearchParams({ organizationId: scope.organizationId });
  if (scope.type === 'branch') query.set('branchId', scope.branchId);
  return apiRequest<OperationsFormTemplate[]>(
    `/api/v1/operations/forms/templates?${query.toString()}`,
  );
}

export function createOperationsFormTemplate(input: {
  organizationId: string;
  branchId?: string;
  name: string;
  description: string;
  definition: FormDefinition;
}) {
  return apiRequest<OperationsFormTemplate>('/api/v1/operations/forms/templates', {
    method: 'POST',
    body: { ...input, scopeType: input.branchId ? 'branch' : 'organization' },
  });
}

export function updateOperationsFormTemplate(
  templateId: string,
  scope: OperationsScope,
  input: {
    name?: string;
    description?: string;
    definition?: FormDefinition;
    enabled?: boolean;
  },
) {
  return apiRequest<OperationsFormTemplate>(
    `/api/v1/operations/forms/templates/${encodeURIComponent(templateId)}`,
    {
      method: 'PATCH',
      body: {
        organizationId: scope.organizationId,
        ...(scope.type === 'branch' ? { branchId: scope.branchId } : {}),
        ...input,
      },
    },
  );
}
