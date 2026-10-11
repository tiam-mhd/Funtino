import { z } from 'zod';

export const eventTypes = {
  userRegistered: 'identity.user-registered.v1',
  householdCreated: 'customer.household-created.v1',
  householdMemberCreated: 'customer.household-member-created.v1',
  cardLinked: 'wallet.card-linked.v1',
  deviceTransactionImported: 'device.transaction-imported.v1',
  deviceRegistered: 'device.device-registered.v1',
  deviceUpdated: 'device.device-updated.v1',
  deviceHealthObserved: 'device.health-observed.v1',
  paymentConfirmed: 'payment.payment-confirmed.v1',
  walletCredited: 'wallet.wallet-credited.v1',
  walletCardRegistered: 'wallet.card-registered.v1',
  walletCardStatusChanged: 'wallet.card-status-changed.v1',
  walletCardAssignmentChanged: 'wallet.card-assignment-changed.v1',
  missionCompleted: 'loyalty.mission-completed.v1',
  notificationRequested: 'notifications.notification-requested.v1',
  notificationSent: 'notifications.notification-sent.v1',
  identityPolicyChanged: 'identity.access-policy-changed.v1',
  organizationCreated: 'organization.organization-created.v1',
  organizationUpdated: 'organization.organization-updated.v1',
  organizationStatusChanged: 'organization.organization-status-changed.v1',
  branchCreated: 'organization.branch-created.v1',
  branchUpdated: 'organization.branch-updated.v1',
  branchStatusChanged: 'organization.branch-status-changed.v1',
  formPublished: 'forms.form-published.v1',
  formPaused: 'forms.form-paused.v1',
  formResponseSubmitted: 'forms.response-submitted.v1',
  formResponseStatusChanged: 'forms.response-status-changed.v1',
  formResponseCorrected: 'forms.response-corrected.v1',
} as const;

export type FuntinoEventType = (typeof eventTypes)[keyof typeof eventTypes];

const optionalScope = z.string().uuid().nullable().optional();

export const eventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  eventVersion: z.literal(1),
  occurredAt: z.string().datetime({ offset: true }),
  organizationId: optionalScope,
  branchId: optionalScope,
  sourceId: z.string().min(1),
  aggregateId: z.string().min(1),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable().optional(),
  payload: z.record(z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const userRegisteredPayloadSchema = z.object({
  userId: z.string().uuid(),
});

export const householdCreatedPayloadSchema = z.object({
  householdId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
});

export const householdMemberCreatedPayloadSchema = z
  .object({
    householdId: z.string().uuid(),
    memberId: z.string().uuid(),
  })
  .strict();

export const cardLinkedPayloadSchema = z.object({
  cardId: z.string().uuid(),
  householdId: z.string().uuid(),
  memberId: z.string().uuid().nullable(),
  externalCardId: z.string().min(1),
});

export const deviceTransactionImportedPayloadSchema = z.object({
  transactionId: z.string().uuid(),
  externalEventId: z.string().min(1),
  externalCardId: z.string().min(1),
  transactionKind: z.enum(['top_up', 'spend', 'refund', 'adjustment']),
  amountMinor: z.number().int(),
  currency: z.string().length(3),
  occurredAt: z.string().datetime({ offset: true }),
});

export const deviceRegisteredPayloadSchema = z
  .object({
    deviceId: z.string().uuid(),
    deviceType: z.enum(['rfid_reader', 'terminal', 'access_gate', 'other']),
    displayName: z.string().min(1).max(120),
    status: z.literal('active'),
    version: z.number().int().positive(),
  })
  .strict();

export const deviceUpdatedPayloadSchema = z
  .object({
    deviceId: z.string().uuid(),
    deviceType: z.enum(['rfid_reader', 'terminal', 'access_gate', 'other']),
    displayName: z.string().min(1).max(120),
    status: z.enum(['active', 'suspended', 'retired']),
    version: z.number().int().positive(),
  })
  .strict();

export const deviceHealthObservedPayloadSchema = z
  .object({
    deviceId: z.string().uuid(),
    observationId: z.string().uuid(),
    reportedState: z.enum(['online', 'degraded', 'offline']),
    observedAt: z.string().datetime({ offset: true }),
    isLatest: z.boolean(),
  })
  .strict();

export const paymentConfirmedPayloadSchema = z.object({
  orderId: z.string().uuid(),
  paymentId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
});

export const walletCreditedPayloadSchema = z.object({
  ledgerEntryId: z.string().uuid(),
  walletId: z.string().uuid(),
  assetType: z.enum(['purchased_credit', 'gift_credit', 'loyalty_points']),
  amountMinor: z.number().int(),
  currency: z.string().length(3),
});

export const walletCardRegisteredPayloadSchema = z
  .object({
    cardId: z.string().uuid(),
    status: z.literal('in_stock'),
    verificationStatus: z.literal('unknown'),
    version: z.number().int().positive(),
  })
  .strict();

export const walletCardStatusChangedPayloadSchema = z
  .object({
    cardId: z.string().uuid(),
    previousStatus: z.enum(['in_stock', 'assigned', 'blocked', 'retired']),
    status: z.enum(['in_stock', 'assigned', 'blocked', 'retired']),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      (value.previousStatus === 'in_stock' &&
        ['assigned', 'blocked', 'retired'].includes(value.status)) ||
      (value.previousStatus === 'assigned' &&
        ['in_stock', 'blocked', 'retired'].includes(value.status)) ||
      (value.previousStatus === 'blocked' &&
        (value.status === 'in_stock' || value.status === 'retired')),
  );

export const walletCardAssignmentChangedPayloadSchema = z
  .object({
    assignmentId: z.string().uuid(),
    cardId: z.string().uuid(),
    householdId: z.string().uuid(),
    previousHouseholdId: z.string().uuid().nullable(),
    action: z.enum(['assigned', 'transferred', 'cancelled']),
  })
  .strict()
  .refine((value) => (value.action === 'transferred') === (value.previousHouseholdId !== null));

export const missionCompletedPayloadSchema = z.object({
  missionId: z.string().uuid(),
  householdId: z.string().uuid(),
  rewardType: z.enum(['loyalty_points', 'coupon', 'gift_credit']),
  rewardValue: z.number().int().nonnegative(),
});

export const notificationRequestedPayloadSchema = z.object({
  notificationId: z.string().uuid(),
  userId: z.string().uuid(),
  channel: z.enum(['sms', 'web_push', 'in_app']),
  template: z.string().min(1),
  variables: z.record(z.string()).default({}),
});

export const notificationSentPayloadSchema = z.object({
  notificationId: z.string().uuid(),
  userId: z.string().uuid(),
  channel: z.enum(['sms', 'web_push', 'in_app']),
  providerMessageId: z.string().nullable(),
});

export const identityPolicyChangedPayloadSchema = z
  .object({
    auditId: z.string().uuid(),
    policyVersion: z.number().int().positive(),
    changeType: z.enum([
      'role.created',
      'role.updated',
      'role.disabled',
      'membership.invited',
      'membership.activated',
      'membership.role_changed',
      'membership.suspended',
      'membership.revoked',
      'membership.invitation_expired',
      'permission_override.granted',
      'permission_override.revoked',
      'system.session_policy.updated',
    ]),
    targetType: z.enum(['role', 'membership', 'permission_override', 'system_setting']),
    targetId: z.string().min(1).max(160),
  })
  .strict();

export const identityPolicyChangedEventSchema = eventEnvelopeSchema
  .extend({
    eventType: z.literal(eventTypes.identityPolicyChanged),
    payload: identityPolicyChangedPayloadSchema,
  })
  .strict();

const organizationSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(160),
    slug: z.string().min(1).max(80),
    timezone: z.string().min(1).max(64),
    status: z.enum(['active', 'suspended', 'archived']),
    version: z.number().int().positive(),
  })
  .strict();

const branchOpeningHoursSchema = z.record(
  z.enum(['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  z
    .object({
      open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    })
    .strict()
    .nullable(),
);

const branchSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    name: z.string().min(1).max(160),
    slug: z.string().min(1).max(80),
    address: z.string().max(500),
    city: z.string().min(1).max(120),
    timezone: z.string().min(1).max(64),
    status: z.enum(['active', 'suspended', 'archived']),
    openingHours: branchOpeningHoursSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const organizationCreatedPayloadSchema = organizationSnapshotSchema;
export const organizationUpdatedPayloadSchema = organizationSnapshotSchema;
export const organizationStatusChangedPayloadSchema = z
  .object({
    organizationId: z.string().uuid(),
    previousStatus: z.enum(['active', 'suspended', 'archived']),
    status: z.enum(['active', 'suspended', 'archived']),
    version: z.number().int().positive(),
  })
  .strict();
export const branchCreatedPayloadSchema = branchSnapshotSchema;
export const branchUpdatedPayloadSchema = branchSnapshotSchema;
export const branchStatusChangedPayloadSchema = z
  .object({
    branchId: z.string().uuid(),
    organizationId: z.string().uuid(),
    previousStatus: z.enum(['active', 'suspended', 'archived']),
    status: z.enum(['active', 'suspended', 'archived']),
    version: z.number().int().positive(),
  })
  .strict();

export const formPublishedPayloadSchema = z
  .object({
    formId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();

export const formPausedPayloadSchema = z
  .object({
    formId: z.string().uuid(),
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
    version: z.number().int().positive(),
  })
  .strict();

export const formResponseSubmittedPayloadSchema = z
  .object({
    responseId: z.string().uuid(),
    formId: z.string().uuid(),
    formVersionId: z.string().uuid(),
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
  })
  .strict();

export const formResponseStatusChangedPayloadSchema = z
  .object({
    responseId: z.string().uuid(),
    formId: z.string().uuid(),
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
    previousStatus: z.enum(['new', 'in_review', 'followed_up', 'closed', 'spam']),
    status: z.enum(['new', 'in_review', 'followed_up', 'closed', 'spam']),
  })
  .strict();

export const formResponseCorrectedPayloadSchema = z
  .object({
    responseId: z.string().uuid(),
    formId: z.string().uuid(),
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
    correctionVersion: z.number().int().positive(),
    changedFieldCount: z.number().int().positive().max(100),
  })
  .strict();

export const eventPayloadSchemas = {
  [eventTypes.userRegistered]: userRegisteredPayloadSchema,
  [eventTypes.householdCreated]: householdCreatedPayloadSchema,
  [eventTypes.householdMemberCreated]: householdMemberCreatedPayloadSchema,
  [eventTypes.cardLinked]: cardLinkedPayloadSchema,
  [eventTypes.deviceTransactionImported]: deviceTransactionImportedPayloadSchema,
  [eventTypes.deviceRegistered]: deviceRegisteredPayloadSchema,
  [eventTypes.deviceUpdated]: deviceUpdatedPayloadSchema,
  [eventTypes.deviceHealthObserved]: deviceHealthObservedPayloadSchema,
  [eventTypes.paymentConfirmed]: paymentConfirmedPayloadSchema,
  [eventTypes.walletCredited]: walletCreditedPayloadSchema,
  [eventTypes.walletCardRegistered]: walletCardRegisteredPayloadSchema,
  [eventTypes.walletCardStatusChanged]: walletCardStatusChangedPayloadSchema,
  [eventTypes.walletCardAssignmentChanged]: walletCardAssignmentChangedPayloadSchema,
  [eventTypes.missionCompleted]: missionCompletedPayloadSchema,
  [eventTypes.notificationRequested]: notificationRequestedPayloadSchema,
  [eventTypes.notificationSent]: notificationSentPayloadSchema,
  [eventTypes.identityPolicyChanged]: identityPolicyChangedPayloadSchema,
  [eventTypes.organizationCreated]: organizationCreatedPayloadSchema,
  [eventTypes.organizationUpdated]: organizationUpdatedPayloadSchema,
  [eventTypes.organizationStatusChanged]: organizationStatusChangedPayloadSchema,
  [eventTypes.branchCreated]: branchCreatedPayloadSchema,
  [eventTypes.branchUpdated]: branchUpdatedPayloadSchema,
  [eventTypes.branchStatusChanged]: branchStatusChangedPayloadSchema,
  [eventTypes.formPublished]: formPublishedPayloadSchema,
  [eventTypes.formPaused]: formPausedPayloadSchema,
  [eventTypes.formResponseSubmitted]: formResponseSubmittedPayloadSchema,
  [eventTypes.formResponseStatusChanged]: formResponseStatusChangedPayloadSchema,
  [eventTypes.formResponseCorrected]: formResponseCorrectedPayloadSchema,
} as const;

export function createEventEnvelope<T extends Record<string, unknown>>(input: {
  eventType: FuntinoEventType;
  sourceId: string;
  aggregateId: string;
  correlationId: string;
  payload: T;
  organizationId?: string | null;
  branchId?: string | null;
  causationId?: string | null;
}): EventEnvelope {
  return eventEnvelopeSchema.parse({
    eventId: crypto.randomUUID(),
    eventType: input.eventType,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    organizationId: input.organizationId ?? null,
    branchId: input.branchId ?? null,
    sourceId: input.sourceId,
    aggregateId: input.aggregateId,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    payload: eventPayloadSchemas[input.eventType].parse(input.payload),
  });
}

export const rabbitExchange = 'funtino.events.v1';
export const rabbitDeadLetterExchange = 'funtino.events.dlx';

export const rabbitRoutingKeys = Object.values(eventTypes);
