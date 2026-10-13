import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { normalizeFamilyPhone } from './customer-family.service.js';
import { CustomerHouseholdClient } from '../../infrastructure/customer-household/customer-household.client.js';
import { WalletClient } from '../../infrastructure/wallet/wallet.client.js';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';

const lookupWindowMs = 15 * 60 * 1000;
const lookupMaxRequests = 30;

@Injectable()
export class CustomerFamilySupportService {
  constructor(
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
    private readonly households: CustomerHouseholdClient,
    private readonly wallet: WalletClient,
  ) {}

  async lookup(input: {
    phone: string;
    organizationId: string;
    branchId: string;
    actorUserId: string;
    correlationId: string;
  }) {
    const now = Date.now();
    const windowStartedAt = Math.floor(now / lookupWindowMs) * lookupWindowMs;
    const count = await this.store.consumeOperationsCustomerLookupQuota({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      windowStartedAt,
      maxRequests: lookupMaxRequests,
    });
    const scope = { organizationId: input.organizationId, branchId: input.branchId };
    await this.store.recordAudit(
      input.actorUserId,
      'operations.customer.family_lookup',
      'branch',
      input.branchId,
      input.correlationId,
      null,
      scope,
    );
    if (count > lookupMaxRequests) {
      if (count === lookupMaxRequests + 1) {
        await this.store.recordAudit(
          input.actorUserId,
          'operations.customer.family_lookup_rate_limited',
          'branch',
          input.branchId,
          input.correlationId,
          'fixed_window_limit_exceeded',
          scope,
        );
      }
      throw new HttpException(
        'تعداد جست‌وجوی مشتری از حد مجاز گذشت؛ کمی بعد دوباره تلاش کنید.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let phone: string;
    try {
      phone = normalizeFamilyPhone(input.phone);
    } catch {
      throw new DomainError('VALIDATION_ERROR', 'شماره تلفن معتبر نیست.');
    }
    const user = await this.store.getUserByPhone(phone);
    if (!user) return { items: [] };
    await this.store.recordAudit(
      input.actorUserId,
      'operations.customer.family_lookup',
      'customer_user',
      user.id,
      input.correlationId,
      null,
      scope,
    );

    const family = await this.households.listFamilyForUser(user.id);
    const assignmentsByHousehold = await Promise.all(
      family.items.map(
        async (household) =>
          [household.id, await this.wallet.listHouseholdAssignments(household.id)] as const,
      ),
    );
    const assignedHouseholds = new Set(
      assignmentsByHousehold
        .filter(([, assignments]) =>
          assignments.some(
            (assignment) =>
              assignment.status === 'assigned' &&
              assignment.organizationId.toLowerCase() === input.organizationId.toLowerCase() &&
              assignment.branchId.toLowerCase() === input.branchId.toLowerCase(),
          ),
        )
        .map(([householdId]) => householdId.toLowerCase()),
    );
    const scopedHouseholds = family.items.filter((household) =>
      assignedHouseholds.has(household.id.toLowerCase()),
    );
    const histories = await Promise.all(
      scopedHouseholds.map(
        async (household) =>
          [
            household.id.toLowerCase(),
            await this.households.listFamilyAuditHistory(input.actorUserId, household.id),
          ] as const,
      ),
    );
    const historyByHousehold = new Map(histories);
    const items = scopedHouseholds.map((household) => ({
      householdId: household.id,
      householdName: household.name,
      members: household.members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        relationshipLabel: member.relationshipLabel,
        relationshipStatus: member.relationshipStatus,
        legacyRelationship:
          member.relationshipStatus === 'needs_review' ? member.relationship : null,
        isAccountLinked: member.isAccountLinked,
        isDependent: member.isDependent,
        status: member.status,
      })),
      invitations: household.invitations.map((invitation) => ({
        memberName: invitation.memberName,
        status: invitation.status,
      })),
      relationships: household.relationships.map((edge) => ({
        fromMemberId: edge.fromMemberId,
        toMemberId: edge.toMemberId,
        kind: edge.kind,
        basis: edge.basis,
      })),
      history: historyByHousehold.get(household.id.toLowerCase()) ?? [],
    }));

    await Promise.all(
      items.map((item) =>
        this.store.recordAudit(
          input.actorUserId,
          'operations.customer.family_read',
          'household',
          item.householdId,
          input.correlationId,
          null,
          scope,
        ),
      ),
    );
    return { items };
  }
}
