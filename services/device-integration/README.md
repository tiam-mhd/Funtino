# Device Integration

Device Integration owns the device registry, normalized health observations, the legacy signed device-transaction intake, and its PostgreSQL schema. It is an internal service; browsers and physical devices must not call registry management routes directly.

## Boundaries and security

- Registry management is called by the API Gateway with `x-funtino-service-id: api-gateway` and the runtime-only `DEVICE_INTEGRATION_GATEWAY_TOKEN`. The Gateway remains responsible for authenticating the user and enforcing IAM permission and organization/branch scope on every request. This owner service independently verifies that a branch is currently active with Organization & Branch before registration or reactivation.
- Branch validation uses `ORGANIZATION_BRANCH_INTERNAL_URL` and the separate `DEVICE_INTEGRATION_ORGANIZATION_BRANCH_TOKEN`. Missing configuration, timeout, or an invalid owner response fails closed.
- Health and existing transaction webhooks require `x-device-signature: sha256=<hex>` where the signature is HMAC-SHA256 of the exact raw request body. `DEVICE_WEBHOOK_SECRET` must be at least 32 characters and is only a runtime secret. No device credential or provider response is stored in the registry.
- The HTTP server caps request bodies at 128,000 bytes. Provider adapters must normalize to the documented schemas and keep signed payloads within this bound.
- Organization and branch IDs are opaque references. There is no cross-service database foreign key or direct read of Organization & Branch tables.

## Registry and health rules

- A device identity is unique by `(organizationId, adapterKey, externalDeviceId)`. Re-registering it under a different command key conflicts; the service never silently moves a device between branches.
- Register/update commands require actor, reason, correlation ID and a UUID `Idempotency-Key`. Same key and same canonical command replay the original result; same key with changed content returns conflict. `If-Match` protects edits from stale versions.
- Device lifecycle is `active -> suspended -> active` or `active/suspended -> retired`; `retired` is terminal. Device lifecycle status is separate from health.
- Each signed health report has a stable `externalObservationId`. All unique observations are retained. An older/out-of-order observation cannot replace a newer latest observation; consumers must also compare `observedAt` before updating a projection. Reusing an observation ID with changed content conflicts.
- `healthState` is derived at read time from the persisted latest observation: `unknown`, `online`, `degraded`, `stale` or `offline`. Defaults are 300 seconds to stale and 900 seconds to offline; runtime thresholds are configurable and offline must exceed stale. A registration with no observation is `unknown`, never online.
- Audit, state changes and versioned outbox events are committed in one PostgreSQL transaction. Health observations and accepted transaction event IDs are append-only. RabbitMQ outages leave committed events in the outbox for bounded retry; after 12 failures an event is dead-lettered for operator review.

## API and contracts

Internal HTTP API: [`contracts/openapi/device-integration.yaml`](../../contracts/openapi/device-integration.yaml).

- `POST /internal/v1/organizations/{organizationId}/branches/{branchId}/devices`
- `GET /internal/v1/organizations/{organizationId}/devices` (optional branch/status filter; keyset cursor, maximum 100)
- `GET` and `PATCH /internal/v1/organizations/{organizationId}/branches/{branchId}/devices/{deviceId}`
- `POST /internal/v1/device/health-observations` (signed normalized adapter input)
- `POST /internal/v1/device/events` (existing signed financial/device event contract)

Versioned domain events are `device.device-registered.v1`, `device.device-updated.v1`, and `device.health-observed.v1`; the existing `device.transaction-imported.v1` remains unchanged. JSON Schemas live under `contracts/events/device/` and AsyncAPI references them. Event consumers are idempotent and must treat the read API/projection—not event delivery—as the recovery path.

## Persistence and operations

- Owner schema: PostgreSQL `device_integration`; Prisma schema and migrations are owned here. Runtime and migration URLs are separate: `DEVICE_INTEGRATION_DATABASE_URL` and `DEVICE_INTEGRATION_MIGRATION_DATABASE_URL`.
- Bootstrap the schema, then deploy the versioned migration with a dedicated migration identity. Do not run migration automatically in every app replica. No migration or restore was run against a real database as part of this source change.
- `/health/live` is process liveness. `/health/ready` checks PostgreSQL and reports pending/dead-lettered outbox counts plus publisher configuration; RabbitMQ is intentionally not a readiness dependency because committed outbox writes remain durable during a broker outage. Dead-letter transitions also emit a count-only error log; payloads and credentials are never logged.
- App rollback must retain the additive database schema and durable rows. Do not automatically drop tables or rewind/delete outbox, observation, audit, or idempotency data. Schema rollback/removal requires an explicitly reviewed backup/restore plan; this implementation has not exercised production backup/restore.
- Local commands:

```powershell
pnpm --filter @funtino/device-integration prisma:generate
pnpm --filter @funtino/device-integration prisma:migrate
pnpm --filter @funtino/device-integration typecheck
pnpm --filter @funtino/device-integration test
pnpm --filter @funtino/device-integration lint
pnpm --filter @funtino/device-integration build
```

The real RFID/provider protocol, provider-specific authentication/rotation, and live hardware smoke test remain separate. This service provides the normalized ACL contract and does not claim a physical provider is connected. API Gateway/Operations Web wiring and Runflare deployment are also outside this service-owner implementation; no deployment repository or external environment was changed.
