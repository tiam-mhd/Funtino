/* Generated from contracts/events/device/windows-edge-contract.v1.schema.json. Do not edit by hand. */
import { z } from "zod";

export const edgeTransactionPayloadSchema = z
  .object({
    eventId: z.string().uuid(),
    sourceInstanceId: z.string().uuid(),
    localTransactionId: z.string().min(1).max(160),
    sourceDatabase: z.string().min(1).max(160),
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
    cardId: z.string().uuid(),
    householdId: z.string().uuid(),
    memberId: z.string().uuid().nullable(),
    deviceId: z.string().uuid().nullable(),
    sourceDeviceId: z.string().max(160).nullable(),
    attractionId: z.string().uuid().nullable(),
    transactionKind: z.enum([
      "top_up",
      "spend",
      "refund",
      "adjustment",
      "issuance",
      "card_replacement",
    ]),
    amountRial: z.number().int().safe(),
    currencyCode: z.literal("IRR"),
    grossAmountRial: z.number().int().safe().nonnegative(),
    discountAmountRial: z.number().int().safe().nonnegative(),
    netAmountRial: z.number().int().safe().nonnegative(),
    promotionId: z.string().min(1).max(160).nullable(),
    ruleId: z.string().min(1).max(160).nullable(),
    pricingVersion: z.string().min(1).max(80).nullable(),
    occurredAt: z.string().datetime({ offset: true }),
    localSequence: z.number().int().safe().positive(),
    balanceAfterRial: z.number().int().safe().nonnegative().nullable(),
    operationResult: z.enum(["success", "cancelled", "failed"]),
    snapshotVersion: z.string().min(1).max(120),
    reversalOfLocalTransactionId: z.string().min(1).max(160).nullable(),
  })
  .strict();
export type EdgeTransactionPayload = z.infer<
  typeof edgeTransactionPayloadSchema
>;

export const edgeEventBatchRequestSchema = z
  .object({
    sourceInstanceId: z.string().uuid(),
    events: z.array(z.unknown()).min(1).max(100),
  })
  .strict();
export type EdgeEventBatchRequest = z.infer<typeof edgeEventBatchRequestSchema>;

export const edgeIngestResultSchema = z.union([
  z
    .object({
      eventId: z.string().uuid(),
      status: z.literal("accepted"),
      errorCode: z.literal(null),
      retryable: z.literal(false),
    })
    .strict(),
  z
    .object({
      eventId: z.string().uuid(),
      status: z.literal("duplicate"),
      errorCode: z.literal(null),
      retryable: z.literal(false),
    })
    .strict(),
  z
    .object({
      eventId: z.string().uuid().nullable(),
      status: z.literal("rejected"),
      errorCode: z.enum([
        "INVALID_EVENT",
        "INSTALLATION_NOT_AUTHORIZED",
        "INSTALLATION_SCOPE_MISMATCH",
        "RATE_LIMITED",
        "EVENT_CONFLICT",
        "TEMPORARY_UNAVAILABLE",
        "CARD_NOT_FOUND",
        "HOUSEHOLD_NOT_FOUND",
        "MEMBER_NOT_FOUND",
        "DEVICE_NOT_FOUND",
        "ATTRACTION_NOT_FOUND",
      ]),
      retryable: z.boolean(),
    })
    .strict(),
]);
export type EdgeIngestResult = z.infer<typeof edgeIngestResultSchema>;

export const edgeIngestResponseSchema = z
  .object({ results: z.array(edgeIngestResultSchema).min(1).max(100) })
  .strict();
export type EdgeIngestResponse = z.infer<typeof edgeIngestResponseSchema>;

export const edgeCardMappingSchema = z
  .object({
    cardId: z.string().uuid(),
    cardUidHash: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
    householdId: z.string().uuid(),
    memberId: z.string().uuid().nullable(),
  })
  .strict();
export type EdgeCardMapping = z.infer<typeof edgeCardMappingSchema>;

export const edgeSnapshotItemSchema = z
  .object({
    kind: z.enum(["device", "card_mapping", "attraction", "setting"]),
    value: z.record(z.string(), z.unknown()),
  })
  .strict();
export type EdgeSnapshotItem = z.infer<typeof edgeSnapshotItemSchema>;

export const edgeSnapshotPageSchema = z
  .object({
    snapshotId: z.string().uuid(),
    snapshotVersion: z.string().min(1).max(120),
    branchId: z.string().uuid(),
    generatedAt: z.string().datetime({ offset: true }),
    validFrom: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }),
    documentHash: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
    pricing: z
      .object({
        status: z.literal("disabled"),
        version: z.literal(null),
        reasonCode: z.literal("PENDING_WINDOWS_GOLDEN_VECTORS"),
        rules: z.array(z.unknown()).max(0),
      })
      .strict(),
    attractions: z.array(z.record(z.string(), z.unknown())),
    settings: z.array(z.record(z.string(), z.unknown())),
    items: z.array(edgeSnapshotItemSchema),
    nextCursor: z.string().max(2048).nullable(),
    signingKeyId: z.string().min(1).max(120),
    signature: z.string().regex(new RegExp("^sha256=[a-f0-9]{64}$")),
  })
  .strict();
export type EdgeSnapshotPage = z.infer<typeof edgeSnapshotPageSchema>;

export const edgeCardAssignmentRequestSchema = z
  .object({
    cardId: z.string().uuid(),
    householdId: z.string().uuid(),
    memberId: z.string().uuid().nullable().optional(),
    expectedVersion: z.number().int().safe().positive(),
    reason: z.string().min(8).max(500),
  })
  .strict();
export type EdgeCardAssignmentRequest = z.infer<
  typeof edgeCardAssignmentRequestSchema
>;

export const edgeCardCommandRequestSchema = z
  .object({
    expectedVersion: z.number().int().safe().positive(),
    reason: z.string().min(8).max(500),
  })
  .strict();
export type EdgeCardCommandRequest = z.infer<
  typeof edgeCardCommandRequestSchema
>;

export const edgeCardAssignmentResultSchema = z
  .object({
    assignmentId: z.string().uuid(),
    cardId: z.string().uuid(),
    householdId: z.string().uuid(),
    memberId: z.string().uuid().nullable(),
    status: z.literal("assigned"),
    verificationStatus: z.literal("verified"),
    maskedIdentifier: z.string().min(1).max(32),
  })
  .strict();
export type EdgeCardAssignmentResult = z.infer<
  typeof edgeCardAssignmentResultSchema
>;

export const edgeCardBlockResultSchema = z
  .object({
    cardId: z.string().uuid(),
    status: z.literal("blocked"),
    recordVersion: z.number().int().safe().positive(),
    maskedIdentifier: z.string().min(1).max(32),
  })
  .strict();
export type EdgeCardBlockResult = z.infer<typeof edgeCardBlockResultSchema>;

export const edgeCardReplacementRequestResultSchema = z
  .object({
    requestId: z.string().uuid(),
    cardId: z.string().uuid(),
    status: z.enum(["requested", "in_review", "approved"]),
    duplicate: z.boolean(),
  })
  .strict();
export type EdgeCardReplacementRequestResult = z.infer<
  typeof edgeCardReplacementRequestResultSchema
>;

export const edgeCustomerSearchQuerySchema = z
  .object({
    branchId: z.string().uuid(),
    query: z.string().min(1).max(120),
    cursor: z.string().uuid().optional(),
    pageSize: z.number().int().safe().positive().max(100).optional(),
  })
  .strict();
export type EdgeCustomerSearchQuery = z.infer<
  typeof edgeCustomerSearchQuerySchema
>;

export const edgeCustomerSearchItemSchema = z
  .object({
    customerId: z.string().uuid(),
    displayName: z.string().min(1).max(160),
    maskedPhone: z.string().regex(new RegExp(".*[•*xX].*")).max(24).nullable(),
    householdId: z.string().uuid(),
    memberId: z.string().uuid().nullable(),
    recordVersion: z.number().int().safe().nonnegative(),
  })
  .strict();
export type EdgeCustomerSearchItem = z.infer<
  typeof edgeCustomerSearchItemSchema
>;

export const edgeCustomerSearchPageSchema = z
  .object({
    items: z.array(edgeCustomerSearchItemSchema).max(100),
    nextCursor: z.string().uuid().nullable(),
  })
  .strict();
export type EdgeCustomerSearchPage = z.infer<
  typeof edgeCustomerSearchPageSchema
>;

export const edgeCustomerProfileSchema = z
  .object({
    customerId: z.string().uuid(),
    firstName: z.string().max(60).nullable(),
    lastName: z.string().max(60).nullable(),
    birthDate: z.string().date().nullable(),
    gender: z.enum(["female", "male", "other", "prefer_not_to_say"]).nullable(),
    city: z.string().max(80).nullable(),
    avatarPreset: z.string().max(32).nullable(),
    hasUploadedAvatar: z.boolean(),
    profileCompleted: z.boolean(),
    recordVersion: z.number().int().safe().positive(),
    maskedPhone: z.string().regex(new RegExp(".*[•*xX].*")).max(24).nullable(),
  })
  .strict();
export type EdgeCustomerProfile = z.infer<typeof edgeCustomerProfileSchema>;

export const edgeCustomerProfilePatchRequestSchema = z
  .object({
    branchId: z.string().uuid(),
    expectedVersion: z.number().int().safe().positive(),
    firstName: z.string().min(1).max(60).nullable().optional(),
    lastName: z.string().min(1).max(60).nullable().optional(),
    birthDate: z.string().date().nullable().optional(),
    gender: z
      .enum(["female", "male", "other", "prefer_not_to_say"])
      .nullable()
      .optional(),
    city: z.string().max(80).nullable().optional(),
    avatarPreset: z.string().max(32).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length >= 3);
export type EdgeCustomerProfilePatchRequest = z.infer<
  typeof edgeCustomerProfilePatchRequestSchema
>;

export const edgeHouseholdMemberSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().max(80),
    relationship: z.string().max(40),
    birthDate: z.string().date().nullable(),
    isDependent: z.boolean(),
    status: z.enum(["active", "pending", "archived"]),
    recordVersion: z.number().int().safe().positive(),
  })
  .strict();
export type EdgeHouseholdMember = z.infer<typeof edgeHouseholdMemberSchema>;

export const edgeHouseholdReadSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
    status: z.enum(["active", "suspended", "archived"]),
    recordVersion: z.number().int().safe().positive(),
    members: z.array(edgeHouseholdMemberSchema),
  })
  .strict();
export type EdgeHouseholdRead = z.infer<typeof edgeHouseholdReadSchema>;

export const edgeHouseholdPatchRequestSchema = z
  .object({
    branchId: z.string().uuid(),
    expectedVersion: z.number().int().safe().positive(),
    name: z.string().min(2).max(80),
  })
  .strict();
export type EdgeHouseholdPatchRequest = z.infer<
  typeof edgeHouseholdPatchRequestSchema
>;

export const edgeHouseholdMemberCreateRequestSchema = z
  .object({
    branchId: z.string().uuid(),
    displayName: z.string().min(2).max(80),
    relationship: z.string().min(2).max(40),
    birthDate: z.string().date().nullable().optional(),
    isDependent: z.boolean().optional(),
  })
  .strict();
export type EdgeHouseholdMemberCreateRequest = z.infer<
  typeof edgeHouseholdMemberCreateRequestSchema
>;

export const edgeProfileMutationResultSchema = z
  .object({
    customerId: z.string().uuid(),
    recordVersion: z.number().int().safe().positive(),
    maskedPhone: z.string().regex(new RegExp(".*[•*xX].*")).max(24).nullable(),
  })
  .strict();
export type EdgeProfileMutationResult = z.infer<
  typeof edgeProfileMutationResultSchema
>;

export const edgeHouseholdMutationResultSchema = z
  .object({
    householdId: z.string().uuid(),
    recordVersion: z.number().int().safe().positive(),
  })
  .strict();
export type EdgeHouseholdMutationResult = z.infer<
  typeof edgeHouseholdMutationResultSchema
>;

export const edgeHouseholdMemberMutationResultSchema = z
  .object({
    memberId: z.string().uuid(),
    householdId: z.string().uuid(),
    recordVersion: z.number().int().safe().positive(),
  })
  .strict();
export type EdgeHouseholdMemberMutationResult = z.infer<
  typeof edgeHouseholdMemberMutationResultSchema
>;
