# Wallet owner service

Wallet is the sole owner of the operational physical-card inventory. This source service uses its own PostgreSQL schema (`wallet`) and an internal, Gateway-only API. Organization and branch identifiers are opaque references validated against the Organization & Branch owner; there are no cross-service foreign keys or database reads.

## Implemented scope

- Branch-scoped card inventory registration, listing, lookup and lifecycle (`in_stock`, `blocked`, `retired`). Retired cards are terminal; a blocked card can return to stock only while its branch is active.
- Manual entries begin with verification status `unknown` and cannot be assigned until physical verification. No RFID provider, online state, financial balance or wallet ledger is inferred here.
- An active verified in-stock card can be assigned to one active household at one branch. Uniqueness is enforced for `(householdId, branchId)` and for the physical card; each branch has an independent household card. The v1 card is shared by the household, not bound to a member.
- Assignment, same-branch household transfer and cancellation use live Customer & Household / Organization & Branch validation and write immutable assignment history, audit, idempotency response and Outbox event atomically. Cross-branch card transfer is not supported.
- Card identifiers are stored only in Wallet, globally unique within the owner, and returned only as a fixed mask. They are excluded from audit snapshots, event payloads, idempotency responses and application log messages.
- Mutations require a Gateway service token, actor ID, correlation ID, reason, idempotency key and (for status changes) `If-Match`. Each committed mutation writes inventory history, idempotency response and a versioned Outbox event in the same PostgreSQL transaction.
- Organization & Branch validation is fail-closed. IAM permission and user/scope checks belong to the authenticated Gateway request; Wallet does not calculate role permissions itself.

## Internal API

The private contract is `contracts/openapi/wallet.yaml`. It defines:

- `GET/POST /internal/v1/organizations/{organizationId}/branches/{branchId}/cards`
- `GET/PATCH /internal/v1/organizations/{organizationId}/branches/{branchId}/cards/{cardId}`
- Branch inventory assignment listing, assignment creation, same-branch transfer and cancellation; household assignment listing; and a narrow active-assignment lookup for trusted Gateway authorization.

The service must not be exposed as a public ingress. Gateway and Operations Web consume inventory and assignment commands; Customer Web reads only active assignments for households the authenticated customer is authorized to access. Customer & Household remains the authority for household access, and Wallet validates that authority before every assignment mutation. Responses never include the raw physical identifier, member-specific assignment, balance or unsourced device history.

## Database and migration

Runtime uses `WALLET_DATABASE_URL`; Docker startup also needs `WALLET_MIGRATION_DATABASE_URL` for the DDL phase. Both URLs must point to the same database with schema `wallet` (their hosts may differ when runtime uses a pooler). Before starting Wallet, the container runs the idempotent schema bootstrap and `prisma migrate deploy` for pending versioned migrations. Failure prevents app startup and emits the sanitized Prisma/PostgreSQL diagnostic; never auto-reset or resolve migration history.

Versioned Wallet migrations create the owner schema and assignment history. They intentionally do not copy or dual-write legacy `public.cards` data in the API Gateway. Production cutover still requires the ADR-0005 snapshot/count/reconciliation/backup and rollback procedure, a separately approved backfill, and a staged consumer switch; none of those real-data operations has been run.

The migration is forward-only. If an application rollout is rolled back before any Wallet writes or consumer cutover, keep the empty schema and disable the Wallet deployment; do not drop database objects as an automatic rollback. After writes begin, preserve the owner data and recover only through the approved backup/restore and reconciliation procedure.

## Runtime configuration

- `WALLET_GATEWAY_TOKEN`: unique internal Gateway credential, at least 32 characters.
- `WALLET_ORGANIZATION_BRANCH_INTERNAL_URL` and `WALLET_ORGANIZATION_BRANCH_TOKEN`: private owner URL and unique Wallet caller token; production URL must use HTTPS and redirects are rejected. Organization & Branch must also have the matching `ORGANIZATION_BRANCH_WALLET_TOKEN`.
- `WALLET_CUSTOMER_HOUSEHOLD_INTERNAL_URL` and `WALLET_CUSTOMER_HOUSEHOLD_TOKEN`: private household owner URL and a separate caller token; production URL must use HTTPS. Customer & Household must hold the matching `CUSTOMER_HOUSEHOLD_WALLET_TOKEN`.
- `WALLET_DATABASE_URL` and `WALLET_MIGRATION_DATABASE_URL`: separate least-privilege runtime and migration connections.
- `WALLET_METRICS_TOKEN`: unique token for the protected internal metrics endpoint.
- `RABBITMQ_URL`: optional in local development; without it events remain durable in PostgreSQL Outbox. Production must provision and monitor the publisher before relying on event consumers.

Generate a random secret per environment. Configure the same value only on the Gateway/Wallet pair; do not reuse the Owner, Identity, Analytics, Device or other service credentials.

## Verification

`pnpm --filter @funtino/wallet prisma:generate`, `typecheck`, `test`, `build`, and root contract validation are the source checks. The schema migration must also be applied twice against a disposable PostgreSQL database and included in backup/restore smoke before release. No production migration or deployment has been run for this source change.
