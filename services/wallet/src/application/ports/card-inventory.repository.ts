import type {
  CardInventoryStatus,
  CardManualStatusTarget,
  CardAssignmentView,
  CardInventoryView,
} from '../../domain/card-inventory/card-inventory.js';

export const CARD_INVENTORY_REPOSITORY = Symbol('CARD_INVENTORY_REPOSITORY');

export type CardCommandMeta = {
  callerService: 'api-gateway';
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
};

export type RegisterCardCommand = {
  organizationId: string;
  branchId: string;
  externalCardId: string;
  reason: string;
};

export type ChangeCardStatusCommand = {
  organizationId: string;
  branchId: string;
  cardId: string;
  expectedVersion: number;
  status: CardManualStatusTarget;
  reason: string;
};

export type AssignCardCommand = {
  organizationId: string;
  branchId: string;
  cardId: string;
  householdId: string;
  reason: string;
};

export type TransferCardAssignmentCommand = {
  organizationId: string;
  branchId: string;
  assignmentId: string;
  householdId: string;
  reason: string;
};

export type CancelCardAssignmentCommand = {
  organizationId: string;
  branchId: string;
  assignmentId: string;
  reason: string;
};

export type ListCardsQuery = {
  organizationId: string;
  branchId: string;
  status?: CardInventoryStatus;
  cursor?: string;
  pageSize: number;
};

export type CardInventoryPage = {
  items: CardInventoryView[];
  nextCursor: string | null;
};

export type CardAssignmentPage = {
  items: CardAssignmentView[];
  nextCursor: string | null;
};

export interface CardInventoryRepository {
  findIdempotentMutation<T extends object>(
    operation: string,
    command: object,
    meta: CardCommandMeta,
  ): Promise<T | null>;
  registerCard(command: RegisterCardCommand, meta: CardCommandMeta): Promise<CardInventoryView>;
  changeCardStatus(
    command: ChangeCardStatusCommand,
    meta: CardCommandMeta,
  ): Promise<CardInventoryView>;
  listCards(query: ListCardsQuery): Promise<CardInventoryPage>;
  getCard(organizationId: string, branchId: string, cardId: string): Promise<CardInventoryView>;
  assignCard(command: AssignCardCommand, meta: CardCommandMeta): Promise<CardAssignmentView>;
  getAssignment(assignmentId: string): Promise<CardAssignmentView>;
  listBranchAssignments(query: {
    organizationId: string;
    branchId: string;
    cursor?: string;
    pageSize: number;
  }): Promise<CardAssignmentPage>;
  listHouseholdAssignments(query: {
    householdId: string;
    cursor?: string;
    pageSize: number;
  }): Promise<{ items: CardAssignmentView[]; nextCursor: string | null }>;
  transferAssignment(
    command: TransferCardAssignmentCommand,
    meta: CardCommandMeta,
  ): Promise<CardAssignmentView>;
  cancelAssignment(
    command: CancelCardAssignmentCommand,
    meta: CardCommandMeta,
  ): Promise<{ assignmentId: string; status: 'cancelled' }>;
  isReady(): Promise<void>;
}
