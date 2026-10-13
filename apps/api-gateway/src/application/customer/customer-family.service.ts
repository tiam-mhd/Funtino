import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { DomainError } from '@funtino/backend-core';
import { normalizePhone } from '../auth/auth.service.js';
import {
  CustomerHouseholdClient,
  type CustomerFamilyMemberInput,
  type CustomerFamilyMemberUpdateInput,
} from '../../infrastructure/customer-household/customer-household.client.js';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';

type CommandMeta = { correlationId: string; idempotencyKey: string };
const familyPhoneLookupWindowMs = 15 * 60 * 1000;
const familyPhoneLookupMaxRequests = 20;
// This reserved UUID is the shared per-customer family-invitation lookup bucket in the Gateway quota table.
const familyPhoneLookupBucket = '00000000-0000-4000-8000-000000000000';

@Injectable()
export class CustomerFamilyService {
  constructor(
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
    private readonly households: CustomerHouseholdClient,
  ) {}

  async listForUser(userId: string) {
    const user = await this.store.getUser(userId);
    return this.households.listFamilyForUser(userId, this.phoneHash(user.phoneE164));
  }

  async addMember(
    actorUserId: string,
    householdId: string,
    input: CustomerFamilyMemberInput & { phone?: string },
    meta: CommandMeta,
  ) {
    const { phone, ...member } = input;
    let target: Pick<CustomerFamilyMemberInput, 'targetUserId' | 'targetPhoneHash'> = {};
    if (phone?.trim()) {
      const now = Date.now();
      const windowStartedAt =
        Math.floor(now / familyPhoneLookupWindowMs) * familyPhoneLookupWindowMs;
      const count = await this.store.consumeOperationsCustomerLookupQuota({
        actorUserId,
        branchId: familyPhoneLookupBucket,
        windowStartedAt,
        maxRequests: familyPhoneLookupMaxRequests,
      });
      await this.store.recordAudit(
        actorUserId,
        'customer.family.invitation.phone_lookup',
        'customer_family_lookup',
        actorUserId,
        meta.correlationId,
        null,
      );
      if (count > familyPhoneLookupMaxRequests) {
        if (count === familyPhoneLookupMaxRequests + 1) {
          await this.store.recordAudit(
            actorUserId,
            'customer.family.invitation.phone_lookup_rate_limited',
            'customer_family_lookup',
            actorUserId,
            meta.correlationId,
            'fixed_window_limit_exceeded',
          );
        }
        throw new HttpException(
          'تعداد جست‌وجوی شماره برای دعوت از حد مجاز گذشت؛ کمی بعد دوباره تلاش کن.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizeFamilyPhone(phone);
      } catch {
        throw new DomainError('VALIDATION_ERROR', 'شماره تلفن معتبر نیست.');
      }
      const registeredUser = await this.store.getUserByPhone(normalizedPhone);
      target = registeredUser
        ? { targetUserId: registeredUser.id }
        : { targetPhoneHash: this.phoneHash(normalizedPhone) };
    }
    return this.households.addFamilyMember(
      actorUserId,
      householdId,
      { ...member, ...target },
      meta,
    );
  }

  async updateMember(
    actorUserId: string,
    householdId: string,
    memberId: string,
    input: CustomerFamilyMemberUpdateInput,
    meta: CommandMeta,
  ) {
    return this.households.updateFamilyMember(actorUserId, householdId, memberId, input, meta);
  }

  async archiveMember(
    actorUserId: string,
    householdId: string,
    memberId: string,
    expectedVersion: number,
    meta: CommandMeta,
  ) {
    return this.households.archiveFamilyMember(
      actorUserId,
      householdId,
      memberId,
      expectedVersion,
      meta,
    );
  }

  async removeRelationship(
    actorUserId: string,
    householdId: string,
    relationshipId: string,
    input: { memberId: string; expectedVersion: number },
    meta: CommandMeta,
  ) {
    return this.households.removeFamilyRelationship(
      actorUserId,
      householdId,
      relationshipId,
      input,
      meta,
    );
  }

  async previewInvitation(token: string) {
    return this.households.previewFamilyInvitation(token);
  }

  async acceptInvitation(
    actorUserId: string,
    invitation: { token?: string; invitationId?: string },
    meta: CommandMeta,
  ) {
    const user = await this.store.getUser(actorUserId);
    return this.households.acceptFamilyInvitation(
      actorUserId,
      { ...invitation, verifiedPhoneHash: this.phoneHash(user.phoneE164) },
      meta,
    );
  }

  async linkInvitation(actorUserId: string, invitationId: string, meta: CommandMeta) {
    return this.households.linkFamilyInvitation(actorUserId, invitationId, meta);
  }

  async approveDependentClaim(actorUserId: string, invitationId: string, meta: CommandMeta) {
    return this.households.approveDependentClaim(actorUserId, invitationId, meta);
  }

  async declineInvitation(actorUserId: string, invitationId: string, meta: CommandMeta) {
    const user = await this.store.getUser(actorUserId);
    return this.households.declineFamilyInvitation(
      actorUserId,
      invitationId,
      this.phoneHash(user.phoneE164),
      meta,
    );
  }

  async revokeInvitation(actorUserId: string, invitationId: string, meta: CommandMeta) {
    return this.households.revokeFamilyInvitation(actorUserId, invitationId, meta);
  }

  private phoneHash(rawPhone: string): string {
    const secret = process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
    if (!secret || secret.length < 32 || secret.length > 512) {
      throw new DomainError(
        'DEPENDENCY_UNAVAILABLE',
        'تنظیم امن پیوند شماره تلفن خانواده در دسترس نیست.',
      );
    }
    let phone: string;
    try {
      phone = normalizeFamilyPhone(rawPhone);
    } catch {
      throw new DomainError('VALIDATION_ERROR', 'شماره تلفن معتبر نیست.');
    }
    return createHmac('sha256', secret)
      .update('funtino-customer-family-phone:v1:')
      .update(phone)
      .digest('hex');
  }
}

export function normalizeFamilyPhone(rawPhone: string): string {
  const asciiDigits = rawPhone.replace(/[\u06f0-\u06f9\u0660-\u0669]/gu, (digit) => {
    const codePoint = digit.codePointAt(0)!;
    const base = codePoint >= 0x06f0 && codePoint <= 0x06f9 ? 0x06f0 : 0x0660;
    return String(codePoint - base);
  });
  return normalizePhone(asciiDigits);
}
