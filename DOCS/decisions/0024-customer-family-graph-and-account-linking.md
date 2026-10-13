# ADR-0024: Customer family graph and account linking

- Status: accepted for implementation
- Date: 2026-10-13
- Decision owners: Product and Engineering
- Related decisions: ADR-0003, ADR-0013, ADR-0015, ADR-0020

## Context

The current Customer & Household owner stores household members with a free-text relationship. The customer family screen is still demo data. Family membership, account linking, legal/biological relationships, and administrative support reads do not yet have an end-to-end contract. Existing card assignment is household-scoped and remains owned by Wallet under ADR-0013.

## Decision

### Ownership and storage

- `services/customer-household` remains the sole owner of household members, family identity links, relationship edges, invitations, and household access grants. The Gateway is a BFF and obtains authenticated account identity and verified phone from its own store. It must not read the Identity & Access or Customer & Household database directly.
- `FamilyPerson` represents an opaque family identity. `accountUserId` is nullable and unique when present. No profile, phone, or OTP material is copied into this service.
- `HouseholdMember` remains a household-scoped membership. New memberships reference `FamilyPerson`; old rows may remain unlinked until a separately approved reconciliation. The existing free-text relationship is preserved as legacy input and is never treated as a verified graph fact.
- `HouseholdRelationship` is a household-scoped, directed edge between memberships. Supported edge kinds are `parent_of`, `spouse_of`, `sibling_of`, and `guardian_of`; biological, legal, adoptive, step, partner, and unspecified bases remain distinct. Reciprocal presentation is derived from explicit edges. Name, phone, birth date, and unstated gender are never used to infer a relationship.
- Relationship writes reject duplicate, cyclic parent/guardian, and contradictory parent/spouse edges. Ambiguous or incomplete paths render a neutral Persian label and a review state. Extended labels such as aunt/uncle and cousin are presented only when every required edge and any required gender fact were explicitly provided.

### Access and consent

- Customer household access is server-enforced. Owners may manage the household, relationships, adult invitations, and dependent claims. Guardians may manage dependent records and dependent claims. Members may read the household and accept an invitation for themselves. A linked account does not gain owner or guardian privileges automatically.
- Adult account links are created only after the invited account accepts. A registered target is addressed by opaque `userId`; an unregistered target is addressed by a Gateway-generated HMAC of its normalized phone. Customer & Household never receives a raw phone number.
- Invitation tokens are generated from 32 bytes of the operating-system CSPRNG and are single-use bearer secrets. Only the SHA-256 token hash is persisted. The raw token is returned once for an unregistered phone invitation or dependent claim link; registered account invitations are delivered through the authenticated family inbox. Idempotency replays never return the token. Tokens are sent in request bodies and browser URL fragments, never path/query, referrer, analytics, or logs. Preview returns only minimal household/member context and has no-store/referrer protections.
- Registered-account invitations do not expire. Invitations addressed by phone hash use `CUSTOMER_FAMILY_UNREGISTERED_INVITATION_TTL_DAYS`, default 7 days. Expired invitation rows are retained; no automatic data deletion is added. This is invitation validity, not a response-retention policy.
- A dependent account claim enters `claim_pending`; only an active owner or guardian can approve it. Linking a conflicting account enters `conflict_review`; there is no automatic merge. A guardian is never derived from a family label.
- Invitation outcomes are generic so callers cannot use the flow to enumerate registered accounts. In-app invitations are available to registered targets. An existing pending invitation is returned without creating a second member or exposing its original link again.
- A linked adult changes only their own displayed member details. Owners and guardians may manage dependent details; a guardian cannot edit a non-dependent member. Creating or removing a relationship that changes another linked adult's family facts requires that adult's own consent. The current mutation path rejects edits that lack this consent rather than silently changing the graph.
- Member and relationship changes use expected member versions and idempotency. Member archival is soft: pending invitations and the member's household access are revoked, audit and relationship history are retained, and household-level Wallet assignments are left intact. Household ownership must be transferred before the owner can leave.

### Events, APIs, and administration

- Mutations use the owner service transaction, an audit row, idempotency, optimistic version checks, and an Outbox event. `customer.household-member-updated.v1` carries household/member IDs, status, and version only. Other versioned event payloads likewise contain opaque IDs and state, not names, birth dates, phone hashes, invitation tokens, or free text.
- Gateway exposes authenticated customer APIs and validates verified-phone ownership before accepting a phone-hash invitation. The invitation token is submitted in a POST body.
- Operations and System family support reads use a dedicated `customer.family.read` permission, exact-phone lookup, selected organization/branch scope, no-store response, quota, and audit. Only households with a current Wallet assignment at that selected branch are returned. These views are read-only, do not export, and do not change card ownership or assignment. Their bounded history contains at most 25 action names and timestamps, with no actor IDs or audit payloads.
- `customer.family.read` is added only to the read-only `system_support`, `organization_crm_manager`, and `branch_crm_manager` templates. It is not added to cashier, operator, or general management templates. The permission definition requires fresh step-up and enforces scope on the server.

### Migration and release

- The schema migration is additive: it creates the new identity, relationship, and invitation structures and nullable links, while preserving existing rows and relationship text. It does not backfill, delete, or rewrite production records.
- A read-only reconciliation report counts legacy unlinked members, duplicate-looking labels, and graph conflicts. Any production backfill requires a separately approved dry-run, reconciliation, and rollback plan; this implementation does not execute or schedule one.
- Rollback is an application rollback that disables the new routes and leaves the additive schema in place. Dropping new tables or rewriting old data is not an automatic rollback action.
- Backend runtime release includes Gateway, Customer & Household, IAM, and event contracts in the backend bundle. Customer, Operations, and System UI changes ship in the frontend bundle. Both snapshots are required before this shared feature is considered released.

## Consequences

- The family page can replace demo state with owner-service data without moving household ownership.
- Legacy free-text relationships remain visible as user-entered text but cannot silently become trusted genealogy.
- Invitation acceptance and dependent linking require explicit consent and authorization checks.
- Support access is independently auditable and restricted to households that have an active assignment at the selected branch.
- Unlinked legacy memberships may show a neutral relationship label until the customer updates their family graph; no production data migration is implied by deployment.

## Acceptance checks

- Tests cover graph reciprocity, cycle/duplicate/conflict rejection, ambiguous path neutrality, invitation enumeration resistance, registered no-expiry behavior, phone-hash validation, token hashing, dependent approval, access control, branch scope, audit, and outbox consistency.
- Tests also verify support history is loaded only after the active Wallet branch assignment filter, member optimistic concurrency, event PII exclusion, and safe retry behavior.
- OpenAPI, AsyncAPI/JSON Schema, service README, customer family documentation, and deployment environment notes match the implementation.
- Source and each affected deployment snapshot are reviewed independently before commit/push; the two affected runtime bundles are released together.
