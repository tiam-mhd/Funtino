import { CustomerApiError, customerApiBaseUrl } from './customer-api';
import type { FormDefinition, FormAnswers } from '@funtino/forms-schema';

export type PublicFormCard = {
  id: string;
  slug: string;
  title: string;
  description: string;
  branchId: string;
};

export type PublicForm = {
  id: string;
  slug: string;
  accessMode: 'guest' | 'optional_auth' | 'auth_required';
  currentVersionId: string;
  definition: FormDefinition;
  endsAt: string | null;
};

export type PublicFormSubmitResult =
  | { status: 'submitted'; responseId: string; submittedAt: string; duplicate: boolean }
  | { status: 'invalid'; issues: Array<{ fieldId: string; message: string }> };

export function getCustomerFormSession() {
  return request<{ authenticated: boolean }>('/api/v1/customer/forms/session');
}

async function request<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${customerApiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload = await response.json().catch(() => null) as { status?: string; data?: T; error?: { message?: string; code?: string } } | null;
  if (!response.ok || payload?.status !== 'success' || payload.data === undefined) {
    throw new CustomerApiError(payload?.error?.message ?? 'پاسخ سرویس معتبر نیست.', response.status, payload?.error?.code);
  }
  return payload.data;
}

export function getPublicForms(branchId?: string) {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  return request<PublicFormCard[]>(`/api/v1/customer/forms${query}`);
}

export function getPublicForm(slug: string) {
  return request<PublicForm>(`/api/v1/customer/forms/${encodeURIComponent(slug)}`);
}

export function submitPublicForm(slug: string, input: {
  answers: FormAnswers;
  idempotencyKey: string;
  linkToAccountConsent: boolean;
  linkParameters?: Record<string, string | undefined>;
}) {
  return request<PublicFormSubmitResult>(`/api/v1/customer/forms/${encodeURIComponent(slug)}/responses`, {
    method: 'POST', body: input,
  });
}
