import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  isCardStatusTransitionAllowed,
  normalizeExternalCardId,
  type CardAssignmentView,
  type CardInventoryView,
} from '../domain/card-inventory/card-inventory.js';
import {
  BRANCH_SCOPE_VALIDATOR,
  type BranchScopeValidator,
} from './ports/branch-scope-validator.port.js';
import {
  CARD_INVENTORY_REPOSITORY,
  type CardCommandMeta,
  type CardInventoryPage,
  type CardInventoryRepository,
  type ChangeCardStatusCommand,
  type AssignCardCommand,
  type TransferCardAssignmentCommand,
  type CancelCardAssignmentCommand,
  type ListCardsQuery,
  type RegisterCardCommand,
} from './ports/card-inventory.repository.js';
import { HOUSEHOLD_VALIDATOR, type HouseholdValidator } from './ports/household-validator.port.js';

@Injectable()
export class CardInventoryService {
  constructor(
    @Inject(CARD_INVENTORY_REPOSITORY) private readonly repository: CardInventoryRepository,
    @Inject(BRANCH_SCOPE_VALIDATOR) private readonly branchScope: BranchScopeValidator,
    @Inject(HOUSEHOLD_VALIDATOR) private readonly householdValidator: HouseholdValidator,
  ) {}

  async registerCard(
    organizationId: string,
    branchId: string,
    input: { externalCardId: string; reason: string },
    meta: CardCommandMeta,
  ): Promise<CardInventoryView> {
    let externalCardId: string;
    try {
      externalCardId = normalizeExternalCardId(input.externalCardId);
    } catch {
      throw new BadRequestException('Card identifier is invalid.');
    }
    const normalizedReason = input.reason.trim();
    if (
      externalCardId.length >= 4 &&
      normalizedReason.toLowerCase().includes(externalCardId.toLowerCase())
    ) {
      throw new BadRequestException('Reason must not contain the physical card identifier.');
    }
    const command: RegisterCardCommand = {
      organizationId,
      branchId,
      externalCardId,
      reason: normalizedReason,
    };
    const replay = await this.repository.findIdempotentMutation<CardInventoryView>(
      'card.inventory.register',
      command,
      meta,
    );
    if (replay) return replay;

    await this.branchScope.assertActiveBranch(organizationId, branchId);
    return this.repository.registerCard(command, meta);
  }

  async changeStatus(
    command: ChangeCardStatusCommand,
    meta: CardCommandMeta,
  ): Promise<CardInventoryView> {
    const normalized = { ...command, reason: command.reason.trim() };
    const replay = await this.repository.findIdempotentMutation<CardInventoryView>(
      'card.inventory.change-status',
      normalized,
      meta,
    );
    if (replay) return replay;

    const current = await this.repository.getCard(
      command.organizationId,
      command.branchId,
      command.cardId,
    );
    if (current.version !== command.expectedVersion)
      throw new ConflictException('Card changed concurrently; reload before retrying.');
    if (!isCardStatusTransitionAllowed(current.status, command.status))
      throw new ConflictException('Card inventory status transition is not allowed.');
    if (current.status === 'blocked' && command.status === 'in_stock') {
      await this.branchScope.assertActiveBranch(command.organizationId, command.branchId);
    }
    return this.repository.changeCardStatus(normalized, meta);
  }

  listCards(query: ListCardsQuery): Promise<CardInventoryPage> {
    return this.repository.listCards(query);
  }

  getCard(organizationId: string, branchId: string, cardId: string): Promise<CardInventoryView> {
    return this.repository.getCard(organizationId, branchId, cardId);
  }

  async assignCard(command: AssignCardCommand, meta: CardCommandMeta): Promise<CardAssignmentView> {
    const normalized = { ...command, reason: command.reason.trim() };
    const replay = await this.repository.findIdempotentMutation<CardAssignmentView>(
      'card.assignment.assign',
      normalized,
      meta,
    );
    if (replay) return replay;
    await this.branchScope.assertActiveBranch(command.organizationId, command.branchId);
    await this.householdValidator.assertActiveHousehold(command.householdId);
    return this.repository.assignCard(normalized, meta);
  }

  getAssignment(assignmentId: string): Promise<CardAssignmentView> {
    return this.repository.getAssignment(assignmentId);
  }

  listBranchAssignments(query: {
    organizationId: string;
    branchId: string;
    cursor?: string;
    pageSize: number;
  }) {
    return this.repository.listBranchAssignments(query);
  }

  async listHouseholdAssignments(query: {
    householdId: string;
    cursor?: string;
    pageSize: number;
  }) {
    await this.householdValidator.assertActiveHousehold(query.householdId);
    return this.repository.listHouseholdAssignments(query);
  }

  async transferAssignment(
    command: TransferCardAssignmentCommand,
    meta: CardCommandMeta,
  ): Promise<CardAssignmentView> {
    const normalized = { ...command, reason: command.reason.trim() };
    const replay = await this.repository.findIdempotentMutation<CardAssignmentView>(
      'card.assignment.transfer',
      normalized,
      meta,
    );
    if (replay) return replay;
    const current = await this.repository.getAssignment(command.assignmentId);
    if (
      current.organizationId.toLowerCase() !== command.organizationId.toLowerCase() ||
      current.branchId.toLowerCase() !== command.branchId.toLowerCase()
    )
      throw new ConflictException('Assignment is outside the requested branch scope.');
    await this.branchScope.assertActiveBranch(current.organizationId, current.branchId);
    await this.householdValidator.assertActiveHousehold(command.householdId);
    return this.repository.transferAssignment(normalized, meta);
  }

  async cancelAssignment(
    command: CancelCardAssignmentCommand,
    meta: CardCommandMeta,
  ): Promise<{ assignmentId: string; status: 'cancelled' }> {
    const normalized = { ...command, reason: command.reason.trim() };
    const replay = await this.repository.findIdempotentMutation<{
      assignmentId: string;
      status: 'cancelled';
    }>('card.assignment.cancel', normalized, meta);
    if (replay) return replay;
    const current = await this.repository.getAssignment(command.assignmentId);
    if (
      current.organizationId.toLowerCase() !== command.organizationId.toLowerCase() ||
      current.branchId.toLowerCase() !== command.branchId.toLowerCase()
    )
      throw new ConflictException('Assignment is outside the requested branch scope.');
    await this.branchScope.assertActiveBranch(current.organizationId, current.branchId);
    return this.repository.cancelAssignment(normalized, meta);
  }
}
