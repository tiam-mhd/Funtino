import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import {
  CustomerFamilyService,
  normalizeFamilyPhone,
} from '../application/customer/customer-family.service.js';
import type { CustomerHouseholdClient } from '../infrastructure/customer-household/customer-household.client.js';
import type { FuntinoStorePort } from '../infrastructure/store/funtino-store.js';

const actorUserId = '45bffab0-e9fd-4d03-b05b-98099a726d9f';
const householdId = 'b43a113e-d5a1-4e61-b314-e6641c03d70c';
const meta = {
  correlationId: '70362658-4ac7-421b-aa9f-9547a938e9e8',
  idempotencyKey: '8c950925-115e-4b5b-a42c-f9e22d8fbcc5',
};

test('family phone normalization accepts Persian and Arabic digits without changing shared OTP normalization', () => {
  assert.equal(normalizeFamilyPhone('۰۹۱۲۳۴۵۶۷۸۹'), '+989123456789');
  assert.equal(normalizeFamilyPhone('٠٩١٢٣٤٥٦٧٨٩'), '+989123456789');
  assert.equal(normalizeFamilyPhone('+۹۸ ۹۱۲ ۳۴۵ ۶۷۸۹'), '+989123456789');
  assert.throws(() => normalizeFamilyPhone('۱۲۳۴۵'));
});

test('registered and unregistered phone invitations send only an opaque identity or HMAC to the owner', async () => {
  const previousSecret = process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
  process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET = randomBytes(32).toString('base64url');
  try {
    const lookups: string[] = [];
    const ownerInputs: unknown[] = [];
    const audits: unknown[][] = [];
    let quotaCount = 0;
    let registered = true;
    const store = {
      consumeOperationsCustomerLookupQuota: async () => ++quotaCount,
      recordAudit: async (...args: unknown[]) => {
        audits.push(args);
      },
      getUserByPhone: async (phone: string) => {
        lookups.push(phone);
        return registered
          ? { id: 'a012acb4-ab83-4bc5-9516-c125f8d30000', phoneE164: phone }
          : undefined;
      },
    } as unknown as FuntinoStorePort;
    const households = {
      addFamilyMember: async (...args: unknown[]) => {
        ownerInputs.push(args);
        return { ok: true };
      },
    } as unknown as CustomerHouseholdClient;
    const service = new CustomerFamilyService(store, households);
    const input = {
      displayName: 'نمونه',
      relationship: 'sibling' as const,
      basis: 'unspecified' as const,
      isDependent: false,
      phone: '۰۹۱۲۳۴۵۶۷۸۹',
    };

    await service.addMember(actorUserId, householdId, input, meta);
    registered = false;
    await service.addMember(actorUserId, householdId, input, {
      ...meta,
      idempotencyKey: '44f34c10-14a1-4f02-8799-3f1c21a3e3c4',
    });

    assert.deepEqual(lookups, ['+989123456789', '+989123456789']);
    const firstOwnerBody = (ownerInputs[0] as unknown[])[2] as Record<string, unknown>;
    const secondOwnerBody = (ownerInputs[1] as unknown[])[2] as Record<string, unknown>;
    assert.equal(firstOwnerBody.targetUserId, 'a012acb4-ab83-4bc5-9516-c125f8d30000');
    assert.equal(firstOwnerBody.targetPhoneHash, undefined);
    assert.equal(secondOwnerBody.targetUserId, undefined);
    assert.equal(
      secondOwnerBody.targetPhoneHash,
      createHmac('sha256', process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET!)
        .update('funtino-customer-family-phone:v1:+989123456789')
        .digest('hex'),
    );
    assert.equal(JSON.stringify(ownerInputs).includes('۰۹۱۲۳۴۵۶۷۸۹'), false);
    assert.equal(audits.length, 2);
  } finally {
    if (previousSecret === undefined) delete process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
    else process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET = previousSecret;
  }
});

test('family phone lookup quota is actor-scoped and stops identity lookup when exhausted', async () => {
  const previousSecret = process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
  process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET = randomBytes(32).toString('base64url');
  try {
    let identityLookups = 0;
    const store = {
      consumeOperationsCustomerLookupQuota: async () => 21,
      recordAudit: async () => undefined,
      getUserByPhone: async () => {
        identityLookups += 1;
        return undefined;
      },
    } as unknown as FuntinoStorePort;
    const households = {
      addFamilyMember: async () => undefined,
    } as unknown as CustomerHouseholdClient;
    const service = new CustomerFamilyService(store, households);
    await assert.rejects(
      service.addMember(
        actorUserId,
        householdId,
        {
          displayName: 'نمونه',
          relationship: 'sibling',
          basis: 'unspecified',
          isDependent: false,
          phone: '09123456789',
        },
        meta,
      ),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
    );
    assert.equal(identityLookups, 0);
  } finally {
    if (previousSecret === undefined) delete process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET;
    else process.env.CUSTOMER_FAMILY_PHONE_HASH_SECRET = previousSecret;
  }
});
