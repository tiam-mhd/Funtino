# ADR-0020: نشست‌های مدیریتی و دسترسی مدیر سراسری

- Date: 2026-10-04
- Status: accepted
- Scope: Identity & Access, API Gateway, System Web, Operations Web
- Supersedes: session duration and idle policy in ADR-0014. ADR-0025 supersedes the per-login MFA requirement; this ADR still governs management session lifetime and the production write gate.
- System-admin permission selection and owner targeting are superseded by ADR-0021; session and write-gate decisions remain active.

## Context

The system administrator needs access to every normal system-management capability, while the current production IAM write gate must remain an explicit rollout control. Management sessions should have an operator-configurable absolute lifetime instead of a short inactivity timeout or repeated five-minute MFA prompts. Customer-only sessions must retain their existing policy.

## Decisions

- The prior permission list for `system_admin` is retained here as history; ADR-0021 now grants every current catalog key through the owner-bound one-off bootstrap.
- The previous exclusions for `system.access.bootstrap` and `system.access.impersonate` are superseded by ADR-0021. These keys do not create an HTTP capability unless a corresponding server-side route is implemented and authorized.
- IAM stores `managementSessionTtlHours` in its owned `policy_state`, as an integer from 1 through 12 with a default of 12. A system administrator can change it in System Web. The setting applies to management sessions created by subsequent logins; active sessions keep their original absolute expiry.
- A login with an active staff membership receives the configured absolute session lifetime. A customer-only login keeps the existing 30-day session lifetime. Cookies use the same expiry as the server-side session.
- Historical rule, superseded by ADR-0025: a global `system_admin` completed MFA on every new login. The active rule permits management OTP login without mandatory MFA; TOTP/recovery is requested only for listed high-risk commands. Session lifetime, live membership/role/scope/permission checks, and the absence of idle timeout remain as decided here.
- The IAM production management-write gate remains default-off. It is not enabled by this code change and must be opened explicitly during the approved rollout window.
- Changing the session policy is a global IAM mutation protected by `system.session_policy.manage`, idempotency, expected policy version, an audit record, and the versioned policy-change Outbox event. Reads and writes flow through Gateway; System Web never connects to IAM storage directly.

## Consequences

- Backend runtime gains an additive IAM migration and Gateway/IAM routes. Frontend runtime gains a System Web session-policy page. Both bundles must be released together because their API contract changes together.
- Existing `system_admin` roles with one of the two previously issued exact permission sets can be reconciled by the one-off `finalize` command after fresh TOTP/recovery verification. Any unexpected permission set fails closed.
- A session-policy update affects the next login; current sessions are neither silently extended nor revoked.
- The allowed session duration is bounded at 12 hours. Extending beyond that requires a new reviewed decision.

## Rollback

Rollback the application snapshots while retaining the additive database column. The previous app ignores that column. Do not drop the column until all runtime revisions that read it have been rolled back or upgraded.
