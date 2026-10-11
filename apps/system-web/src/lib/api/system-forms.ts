import { apiRequest } from './client';
import type { FormDefinition, FormStatus, FormTheme } from '@funtino/forms-schema';

export type SystemFormMetadata = {
  id: string;
  organizationId: string;
  branchId: string;
  slug: string;
  title: string;
  description: string;
  status: FormStatus;
  accessMode: 'guest' | 'optional_auth' | 'auth_required';
  linkEnabled: boolean;
  responseCount: number;
  currentVersion: number | null;
  createdAt: string;
  publishedAt: string | null;
};

export type SystemFormTemplate = {
  id: string;
  scopeType: 'global';
  organizationId: null;
  branchId: null;
  name: string;
  description: string;
  definition: FormDefinition;
  enabled: boolean;
  version: number;
};

export type SystemFormsPage = { items: SystemFormMetadata[]; nextCursor: string | null };
export type SystemFormsSettings = { defaultTheme: FormTheme; updatedAt: string | null };

export function getSystemForms(filters: {
  organizationId?: string; branchId?: string; status?: FormStatus; query?: string; cursor?: string; pageSize?: number;
} = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') query.set(key, String(value));
  return apiRequest<SystemFormsPage>(`/api/v1/system/forms?${query.toString()}`);
}

export function getSystemFormTemplates() {
  return apiRequest<SystemFormTemplate[]>('/api/v1/system/forms/templates');
}

export function createSystemFormTemplate(input: { name: string; description: string; definition: FormDefinition }) {
  return apiRequest<SystemFormTemplate>('/api/v1/system/forms/templates', { method: 'POST', body: input });
}

export function updateSystemFormTemplate(templateId: string, input: {
  name?: string; description?: string; definition?: FormDefinition; enabled?: boolean;
}) {
  return apiRequest<SystemFormTemplate>(`/api/v1/system/forms/templates/${encodeURIComponent(templateId)}`, {
    method: 'PATCH', body: input,
  });
}

export function getSystemFormsSettings() {
  return apiRequest<SystemFormsSettings>('/api/v1/system/forms/settings');
}

export function updateSystemFormsSettings(defaultTheme: FormTheme) {
  return apiRequest<SystemFormsSettings>('/api/v1/system/forms/settings', { method: 'PUT', body: { defaultTheme } });
}
