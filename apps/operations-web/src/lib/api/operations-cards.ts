import { apiRequest, apiRequestPage } from './client';

export type OperationsCardStatus = 'in_stock' | 'assigned' | 'blocked' | 'retired';
export type OperationsCardVerificationStatus = 'unknown' | 'verified' | 'rejected';

export type OperationsCard = {
  id: string;
  organizationId: string;
  branchId: string;
  maskedIdentifier: string;
  status: OperationsCardStatus;
  verificationStatus: OperationsCardVerificationStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OperationsCardCapabilities = {
  canManage: boolean;
  canAssign: boolean;
  canTransfer: boolean;
  canUnassign: boolean;
  canLookupCustomer: boolean;
  requiresStepUp: boolean;
};
export type OperationsCardPage = {
  data: OperationsCard[];
  nextCursor: string | null;
  capabilities: OperationsCardCapabilities;
};

export type OperationsCardAssignment = {
  id: string;
  cardId: string;
  organizationId: string;
  branchId: string;
  householdId: string;
  maskedIdentifier: string;
  status: 'in_stock' | 'assigned' | 'blocked' | 'retired';
  verificationStatus: OperationsCardVerificationStatus;
  assignedAt: string;
};

export type OperationsHouseholdMatch = {
  householdId: string;
  householdName: string;
  maskedPhone: string;
  activeMemberCount: number;
};

function cardsPath(organizationId: string, branchId: string) {
  return `/api/v1/operations/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/cards`;
}

export async function listOperationsCards(
  organizationId: string,
  branchId: string,
  cursor?: string,
  status?: OperationsCardStatus,
): Promise<OperationsCardPage> {
  const query = new URLSearchParams({ pageSize: '25' });
  if (cursor) query.set('cursor', cursor);
  if (status) query.set('status', status);
  const page = await apiRequestPage<{
    items: OperationsCard[];
    capabilities: OperationsCardCapabilities;
  }>(`${cardsPath(organizationId, branchId)}?${query}`);
  return {
    data: page.data.items,
    nextCursor: page.nextCursor,
    capabilities: page.data.capabilities,
  };
}

export async function registerOperationsCard(
  organizationId: string,
  branchId: string,
  input: { externalCardId: string; reason: string },
  idempotencyKey: string,
) {
  return apiRequest<OperationsCard>(cardsPath(organizationId, branchId), {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function changeOperationsCardStatus(
  card: OperationsCard,
  input: { status: OperationsCardStatus; reason: string },
  idempotencyKey: string,
) {
  return apiRequest<OperationsCard>(
    `${cardsPath(card.organizationId, card.branchId)}/${encodeURIComponent(card.id)}`,
    {
      method: 'PATCH',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey, 'If-Match': `"${card.version}"` },
    },
  );
}

function branchAssignmentsPath(organizationId: string, branchId: string) {
  return `/api/v1/operations/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/card-assignments`;
}

export async function listOperationsCardAssignments(
  organizationId: string,
  branchId: string,
  cursor?: string,
) {
  const query = new URLSearchParams({ pageSize: '50' });
  if (cursor) query.set('cursor', cursor);
  const page = await apiRequestPage<{ items: OperationsCardAssignment[] }>(
    `${branchAssignmentsPath(organizationId, branchId)}?${query}`,
  );
  return { items: page.data.items, nextCursor: page.nextCursor };
}

export function lookupOperationsHouseholds(
  organizationId: string,
  branchId: string,
  phone: string,
): Promise<{ items: OperationsHouseholdMatch[] }> {
  return apiRequest(
    `/api/v1/operations/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/customer-households/lookup`,
    { method: 'POST', body: { phone } },
  );
}

export function assignOperationsCard(
  card: OperationsCard,
  input: { phone: string; householdId: string; reason: string },
  idempotencyKey: string,
): Promise<OperationsCardAssignment> {
  return apiRequest(
    `${cardsPath(card.organizationId, card.branchId)}/${encodeURIComponent(card.id)}/assignments`,
    { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export function transferOperationsCard(
  assignment: OperationsCardAssignment,
  input: { phone: string; householdId: string; reason: string },
  idempotencyKey: string,
): Promise<OperationsCardAssignment> {
  return apiRequest(
    `${branchAssignmentsPath(assignment.organizationId, assignment.branchId)}/${encodeURIComponent(assignment.id)}/transfer`,
    { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export function cancelOperationsCardAssignment(
  assignment: OperationsCardAssignment,
  input: { reason: string },
  idempotencyKey: string,
): Promise<{ assignmentId: string; status: 'cancelled' }> {
  return apiRequest(
    `${branchAssignmentsPath(assignment.organizationId, assignment.branchId)}/${encodeURIComponent(assignment.id)}/cancel`,
    { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } },
  );
}
