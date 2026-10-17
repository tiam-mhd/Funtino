# Operations Web login and scope selection

## Ownership and trust boundaries

- OTP identity and the session cookie are owned by API Gateway. Operations Web never stores or manufactures a session token.
- IAM is the source of truth for staff memberships and roles. Scope options are derived only from active memberships with active roles; global memberships are intentionally excluded from the tenant operations console.
- Organization & Branch is the source of truth for current organization/branch names and lifecycle state. Gateway resolves only IAM-derived IDs and omits missing, suspended, or archived resources. A branch option is accepted only when its owner record has the requested parent organization.
- `GET /api/v1/operations/scopes` provides the current eligible tenant scopes. `POST /api/v1/operations/scope-selection` re-reads IAM and owner state, requires a strict organization/branch scope, and appends an audit entry containing actor, organization, branch when applicable, and correlation ID.
- The browser keeps the selected scope only in in-memory UI state; reload requires a fresh selection. No browser storage is treated as authorization state.
- Scope selection is not a permission grant. Every future operation query or mutation must carry its scope and independently authorize the requested permission and exact resource on the server. The selector itself does not make downstream API calls safe.
- Session creation is already audited by Gateway. Scope-selection audit failure rejects the selection. The current audit record uses Gateway's existing `audit_logs` fields; no database migration is required.

## User flow and UI states

1. On page load, Operations Web requests `/api/v1/auth/me`. A missing/expired session opens the OTP login form; other service failures fail closed and offer retry.
2. The user requests a code for their verified phone and submits the six-digit code. The browser normalizes Persian/Arabic numerals, but Gateway remains responsible for validation, rate limiting, challenge expiry, and session creation.
3. After verification, the app fetches current scopes and presents only active organization/branch membership scopes confirmed by their owner service. It also fetches the personal invitation inbox using the verified phone held by the server session; the client cannot submit a lookup phone.
4. The user explicitly accepts a matching invitation. Acceptance activates membership but never selects a scope automatically; the app refreshes scopes and the user still chooses one.
5. Choosing a scope posts it back to Gateway. The UI enters the scoped shell only after server validation and audit succeed. Changing scope repeats that process.
6. No active scope produces an explicit access-denied state while preserving the invitation inbox. Dependency errors do not fall back to cached/demo data. The staff-access module is connected to IAM in the scoped shell; other operational modules remain unavailable until separately implemented.

## Workspace header and scope changes

- The header shows the currently active branch, or “همهٔ شعب” when the active scope is the organization. It does not contain a scope selector.
- The scope selector sits directly below the brand at the top of the sidebar and lists only the scopes already provided to the signed-in user.
- The user name and access label open a compact account menu containing account security and sign-out actions.
- On mobile, the same scope selector stays at the top of the sidebar drawer while the active branch remains visible in the page header.

## Workspace appearance

- The explicit light and dark appearance choice is shared by every Operations Web page and is remembered in the browser. It also applies to the standalone account-security page.
- Before sign-in, the sun/moon control stays in the entry header. In the workspace, the same animated icon control is centered in the sidebar footer; the sidebar expand/collapse action is in the header as a three-line menu button. On mobile that button opens the sidebar drawer.
- Page surfaces, text, borders, fields, tables, notices, and status colors use the Operations-only theme palette. The sidebar keeps its dark brand surface in light mode and deepens in dark mode for consistent contrast.

## Responsive presentation and assets

- The phone, code, optional management-password, and scope-selection screens use an RTL responsive layout. Sign-in, code-entry, and scope-selection states share the same visual frame; the page offers explicit light and dark choices through sun and moon icons with a smoothly animated active indicator before and after sign-in. Login, verification, password, scope, and status cards use a lightly translucent surface with 3px background blur so the park remains subtly visible while text stays readable. The desktop introduction uses a high-contrast glass panel and grouped highlights. Motion respects reduced-motion preferences.
- Desktop uses `login-day-desktop.png` or `login-night-desktop.png`; mobile uses the portrait `login-day-mobile.png` or `login-night-mobile.png` from `apps/operations-web/public/brand/`.
- The source images are the four files supplied for this task in `DOCS/Images/login-backgrounds/`: `Funtino Park in Golden Daylight.png`, `Funtino Nights_ Neon Amusement Park.png`, `Sunny Funtin Amusement Park Adventure.png`, and `Neon Funtino Carnival at Night.png`. The product owner explicitly requested these images for the Operations Web login. No separate third-party license metadata was supplied.
- The supplied `DOCS/Images/logos/logo-operation-panel.png` is the official Operations Web logo. Its transparent WebP version, `apps/operations-web/public/brand/operations-panel-logo.webp`, is used in the login header, workspace sidebar, and browser tab icon. Customer Web and System Web retain their own branding. The logo image keeps the accessible name “فانتینو”; no separate third-party license metadata was supplied.
- The backgrounds are decorative and have no text alternative.
- This is a presentation-only change. It does not change the public contract, ownership boundaries, authentication transitions, or the explicit scope-selection step.

## Contract and source layout

- Public contract: `contracts/openapi/gateway.yaml`.
- Gateway controller: `apps/api-gateway/src/interfaces/http/operations-scope.controller.ts`.
- Scope audit forwarding: `apps/api-gateway/src/application/auth/auth.service.ts` and the existing Gateway audit store implementations.
- Operations UI/API: `apps/operations-web/src/features/branch-scope/`, `src/features/staff-access/`, `src/lib/auth/`, and `src/lib/api/`.
- Scope tests: `apps/api-gateway/src/tests/operations-scope.controller.spec.ts`.

## Deployment and verification notes

- Build-time `NEXT_PUBLIC_API_BASE_URL` must point to the public API Gateway origin over HTTPS in production.
- Gateway `CORS_ORIGINS` must contain the exact Operations Web origin (the same allowlist is used by `TrustedOriginGuard`). The session cookie must remain HTTPS-only in production; the app sends it with credentialed, no-store requests.
- IAM and Organization & Branch service URLs/credentials and OTP provider settings remain runtime secrets/configuration on Gateway. No real credential or customer data belongs in source.
- Source implementation and local automated checks do not constitute a production deployment, live OTP delivery test, database backup/restore test, or pilot approval.

## O0 status

Completed in this slice: OTP/session entry, active organization/branch scope listing and explicit selection, owner-status confirmation, server-side revalidation, scope audit, invitation inbox and explicit verified-phone acceptance, staff roster and scoped access management UI, RTL responsive states, and removal of synthetic business data.

Still outside this slice: role-derived navigation, other operations workspace forms/tables and scoped module APIs, and end-to-end tests proving data isolation between two live branches. The owner-validation boundary is resolved by accepted ADR-0010 and the IAM→Owner validator is connected in source: IAM authorizes the actor, then Owner validates resource state. Runtime mutations fail closed on invalid configuration or owner failure; production rollout still requires staging proof of HTTPS credentials/network, failure behavior, and isolation between live branches. Those concerns must remain independently authorized; O0 as a whole is not declared complete here.
