import { eventEnvelopeSchema, eventPayloadSchemas, eventTypes } from '@funtino/event-contracts';
import { z } from 'zod';

const supportedSources = new Map<string, string>([
  [eventTypes.organizationCreated, 'organization-branch'],
  [eventTypes.organizationUpdated, 'organization-branch'],
  [eventTypes.organizationStatusChanged, 'organization-branch'],
  [eventTypes.branchCreated, 'organization-branch'],
  [eventTypes.branchUpdated, 'organization-branch'],
  [eventTypes.branchStatusChanged, 'organization-branch'],
  [eventTypes.deviceRegistered, 'device-integration'],
  [eventTypes.deviceUpdated, 'device-integration'],
  [eventTypes.deviceHealthObserved, 'device-integration'],
]);

export type SanitizedAnalyticsEvent = {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  sourceId: string;
  aggregateId: string;
  organizationId: string;
  branchId: string | null;
  payload: Record<string, string | number | boolean | null>;
};

export function isSupportedAnalyticsEvent(eventType: string): boolean {
  return supportedSources.has(eventType);
}

/** Validate producer ownership and retain only fields needed by reports/rebuild. */
export function parseAnalyticsEvent(input: unknown): SanitizedAnalyticsEvent | null {
  const envelopeResult = eventEnvelopeSchema.safeParse(input);
  if (!envelopeResult.success) throw new Error('INVALID_ANALYTICS_EVENT_ENVELOPE');
  const event = envelopeResult.data;
  const expectedSource = supportedSources.get(event.eventType);
  if (!expectedSource) return null;
  if (event.sourceId !== expectedSource) throw new Error('INVALID_ANALYTICS_EVENT_SOURCE');

  const payloadSchema = eventPayloadSchemas[event.eventType as keyof typeof eventPayloadSchemas];
  const payloadResult = payloadSchema?.safeParse(event.payload);
  if (!payloadResult?.success) throw new Error('INVALID_ANALYTICS_EVENT_PAYLOAD');
  const payload = payloadResult.data as Record<string, unknown>;
  const organizationId = event.organizationId?.toLowerCase();
  const branchId = event.branchId?.toLowerCase() ?? null;
  const occurredAt = new Date(event.occurredAt);

  if (!organizationId || Number.isNaN(occurredAt.valueOf())) {
    throw new Error('ANALYTICS_EVENT_SCOPE_REQUIRED');
  }

  if (
    event.eventType === eventTypes.organizationCreated ||
    event.eventType === eventTypes.organizationUpdated
  ) {
    const snapshot = payload as z.infer<
      (typeof eventPayloadSchemas)[typeof eventTypes.organizationCreated]
    >;
    if (
      snapshot.id.toLowerCase() !== organizationId ||
      branchId !== null ||
      event.aggregateId.toLowerCase() !== organizationId
    ) {
      throw new Error('ANALYTICS_EVENT_SCOPE_MISMATCH');
    }
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt,
      sourceId: event.sourceId,
      aggregateId: event.aggregateId,
      organizationId,
      branchId: null,
      payload: {
        id: snapshot.id.toLowerCase(),
        name: snapshot.name,
        status: snapshot.status,
        version: snapshot.version,
      },
    };
  }

  if (event.eventType === eventTypes.organizationStatusChanged) {
    const snapshot = payload as z.infer<
      (typeof eventPayloadSchemas)[typeof eventTypes.organizationStatusChanged]
    >;
    if (
      snapshot.organizationId.toLowerCase() !== organizationId ||
      branchId !== null ||
      event.aggregateId.toLowerCase() !== organizationId
    ) {
      throw new Error('ANALYTICS_EVENT_SCOPE_MISMATCH');
    }
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt,
      sourceId: event.sourceId,
      aggregateId: event.aggregateId,
      organizationId,
      branchId: null,
      payload: { id: organizationId, status: snapshot.status, version: snapshot.version },
    };
  }

  if (
    event.eventType === eventTypes.branchCreated ||
    event.eventType === eventTypes.branchUpdated
  ) {
    const snapshot = payload as z.infer<
      (typeof eventPayloadSchemas)[typeof eventTypes.branchCreated]
    >;
    if (
      snapshot.organizationId.toLowerCase() !== organizationId ||
      snapshot.id.toLowerCase() !== branchId ||
      event.aggregateId.toLowerCase() !== branchId
    ) {
      throw new Error('ANALYTICS_EVENT_SCOPE_MISMATCH');
    }
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt,
      sourceId: event.sourceId,
      aggregateId: event.aggregateId,
      organizationId,
      branchId,
      payload: {
        id: snapshot.id.toLowerCase(),
        organizationId,
        name: snapshot.name,
        status: snapshot.status,
        version: snapshot.version,
      },
    };
  }

  if (event.eventType === eventTypes.branchStatusChanged) {
    const snapshot = payload as z.infer<
      (typeof eventPayloadSchemas)[typeof eventTypes.branchStatusChanged]
    >;
    if (
      snapshot.organizationId.toLowerCase() !== organizationId ||
      snapshot.branchId.toLowerCase() !== branchId ||
      event.aggregateId.toLowerCase() !== branchId
    ) {
      throw new Error('ANALYTICS_EVENT_SCOPE_MISMATCH');
    }
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt,
      sourceId: event.sourceId,
      aggregateId: event.aggregateId,
      organizationId,
      branchId,
      payload: {
        id: branchId!,
        organizationId,
        status: snapshot.status,
        version: snapshot.version,
      },
    };
  }

  if (!branchId) throw new Error('ANALYTICS_DEVICE_BRANCH_REQUIRED');
  if (
    event.eventType === eventTypes.deviceRegistered ||
    event.eventType === eventTypes.deviceUpdated
  ) {
    const snapshot = payload as z.infer<
      (typeof eventPayloadSchemas)[typeof eventTypes.deviceRegistered]
    >;
    if (snapshot.deviceId.toLowerCase() !== event.aggregateId.toLowerCase()) {
      throw new Error('ANALYTICS_EVENT_AGGREGATE_MISMATCH');
    }
    return {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt,
      sourceId: event.sourceId,
      aggregateId: event.aggregateId,
      organizationId,
      branchId,
      payload: {
        id: snapshot.deviceId.toLowerCase(),
        displayName: snapshot.displayName,
        deviceType: snapshot.deviceType,
        status: snapshot.status,
        version: snapshot.version,
      },
    };
  }

  const health = payload as z.infer<
    (typeof eventPayloadSchemas)[typeof eventTypes.deviceHealthObserved]
  >;
  if (health.deviceId.toLowerCase() !== event.aggregateId.toLowerCase()) {
    throw new Error('ANALYTICS_EVENT_AGGREGATE_MISMATCH');
  }
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt,
    sourceId: event.sourceId,
    aggregateId: event.aggregateId,
    organizationId,
    branchId,
    payload: {
      id: health.deviceId.toLowerCase(),
      reportedState: health.reportedState,
      observedAt: health.observedAt,
      isLatest: health.isLatest,
    },
  };
}

export function parseArchivedAnalyticsEvent(event: {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  sourceId: string;
  aggregateId: string;
  organizationId: string;
  branchId: string | null;
  payload: unknown;
}): SanitizedAnalyticsEvent {
  const expectedSource = supportedSources.get(event.eventType);
  const eventId = z.string().uuid().safeParse(event.eventId);
  const aggregateId = z.string().uuid().safeParse(event.aggregateId);
  const organizationId = z.string().uuid().safeParse(event.organizationId);
  const branchId = event.branchId === null ? null : z.string().uuid().safeParse(event.branchId);
  const date = event.occurredAt;
  if (
    !expectedSource ||
    expectedSource !== event.sourceId ||
    !eventId.success ||
    !aggregateId.success ||
    !organizationId.success ||
    (branchId !== null && !branchId.success) ||
    Number.isNaN(date.valueOf())
  ) {
    throw new Error('INVALID_ARCHIVED_ANALYTICS_EVENT');
  }
  const archivedPayload = z.record(z.unknown()).safeParse(event.payload);
  if (!archivedPayload.success) throw new Error('INVALID_ARCHIVED_ANALYTICS_PAYLOAD');

  const normalizedSchemas: Record<string, z.ZodType<Record<string, unknown>>> = {
    [eventTypes.organizationCreated]: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        status: z.enum(['active', 'suspended', 'archived']),
        version: z.number().int().positive(),
      })
      .strict(),
    [eventTypes.organizationUpdated]: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        status: z.enum(['active', 'suspended', 'archived']),
        version: z.number().int().positive(),
      })
      .strict(),
    [eventTypes.organizationStatusChanged]: z
      .object({
        id: z.string().uuid(),
        status: z.enum(['active', 'suspended', 'archived']),
        version: z.number().int().positive(),
      })
      .strict(),
    [eventTypes.branchCreated]: z
      .object({
        id: z.string().uuid(),
        organizationId: z.string().uuid(),
        name: z.string(),
        status: z.enum(['active', 'suspended', 'archived']),
        version: z.number().int().positive(),
      })
      .strict(),
    [eventTypes.branchUpdated]: z
      .object({
        id: z.string().uuid(),
        organizationId: z.string().uuid(),
        name: z.string(),
        status: z.enum(['active', 'suspended', 'archived']),
        version: z.number().int().positive(),
      })
      .strict(),
    [eventTypes.branchStatusChanged]: z
      .object({
        id: z.string().uuid(),
        organizationId: z.string().uuid(),
        status: z.enum(['active', 'suspended', 'archived']),
        version: z.number().int().positive(),
      })
      .strict(),
    [eventTypes.deviceRegistered]: z
      .object({
        id: z.string().uuid(),
        displayName: z.string(),
        deviceType: z.enum(['rfid_reader', 'terminal', 'access_gate', 'other']),
        status: z.enum(['active', 'suspended', 'retired']),
        version: z.number().int().positive(),
      })
      .strict(),
    [eventTypes.deviceUpdated]: z
      .object({
        id: z.string().uuid(),
        displayName: z.string(),
        deviceType: z.enum(['rfid_reader', 'terminal', 'access_gate', 'other']),
        status: z.enum(['active', 'suspended', 'retired']),
        version: z.number().int().positive(),
      })
      .strict(),
    [eventTypes.deviceHealthObserved]: z
      .object({
        id: z.string().uuid(),
        reportedState: z.enum(['online', 'degraded', 'offline']),
        observedAt: z.string().datetime({ offset: true }),
        isLatest: z.boolean(),
      })
      .strict(),
  };
  const normalized = normalizedSchemas[event.eventType]?.safeParse(archivedPayload.data);
  if (!normalized?.success) throw new Error('INVALID_ARCHIVED_ANALYTICS_PAYLOAD');

  const orgEvents = new Set<string>([
    eventTypes.organizationCreated,
    eventTypes.organizationUpdated,
    eventTypes.organizationStatusChanged,
  ]);
  const branchEvents = new Set<string>([
    eventTypes.branchCreated,
    eventTypes.branchUpdated,
    eventTypes.branchStatusChanged,
  ]);
  if (orgEvents.has(event.eventType) ? branchId !== null : branchId === null) {
    throw new Error('INVALID_ARCHIVED_ANALYTICS_SCOPE');
  }
  if (
    'organizationId' in normalized.data &&
    normalized.data.organizationId !== organizationId.data
  ) {
    throw new Error('INVALID_ARCHIVED_ANALYTICS_SCOPE');
  }
  const normalizedId = normalized.data.id;
  const expectedScopeId = orgEvents.has(event.eventType)
    ? organizationId.data
    : branchEvents.has(event.eventType)
      ? branchId!.data
      : aggregateId.data;
  if (
    typeof normalizedId !== 'string' ||
    normalizedId.toLowerCase() !== expectedScopeId.toLowerCase()
  ) {
    throw new Error('INVALID_ARCHIVED_ANALYTICS_SCOPE');
  }
  if (event.aggregateId.toLowerCase() !== normalizedId.toLowerCase()) {
    throw new Error('INVALID_ARCHIVED_ANALYTICS_AGGREGATE');
  }
  return {
    eventId: eventId.data.toLowerCase(),
    eventType: event.eventType,
    occurredAt: date,
    sourceId: event.sourceId,
    aggregateId: aggregateId.data.toLowerCase(),
    organizationId: organizationId.data.toLowerCase(),
    branchId: branchId === null ? null : branchId.data.toLowerCase(),
    payload: normalized.data as SanitizedAnalyticsEvent['payload'],
  };
}
