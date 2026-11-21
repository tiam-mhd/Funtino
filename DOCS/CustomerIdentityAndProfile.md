# Customer identity and profile implementation

Date: 2026-09-27

## Scope

This document records the executable customer authentication/profile slice. It supplements the broader analysis documents; the analysis documents remain design inputs and are not implementation instructions by themselves.

## Customer flow

1. The customer enters an Iranian mobile number.
2. `POST /api/v1/auth/otp/request` normalizes the number to E.164, applies the request cooldown, generates a six-digit code through the configured `OtpSender`, stores only a hash, and returns a challenge.
3. `ParsGreenOtpSender` sends the code through Parsgreen REST at `https://sms.parsgreen.ir/Apiv2/Message/SendOtp`, using `Authorization: basic apikey:<token>` and the provider JSON contract. `PARSGREEN_API_TOKEN` is deliberately blank in source and belongs in Runflare secrets.
   If the provider times out after the send attempt, the API persists the challenge and returns `deliveryStatus: "unknown"`; the customer continues to OTP verification and automatic resend is forbidden because the provider outcome is ambiguous.
4. `POST /api/v1/auth/otp/verify` validates phone, expiry, attempt limit and hash, consumes the customer-login challenge, creates/reuses the User without overwriting its profile, and sets the customer-only `funtino_session` HttpOnly cookie. It never creates a management session, even for a user who also has management memberships.
5. The customer must complete first name, last name, birth date, gender, city and an uploaded profile image or an already stored avatar before the main navigation is exposed. Preset-avatar selection is intentionally hidden in the current UI and remains commented in the customer code until the final avatar catalogue/design is approved.
6. The customer can later open a dedicated profile page from the account page and edit each profile field separately. Every newly selected image opens a client-side crop step constrained to a square `1:1` viewport; the confirmed result is normalized to a square JPEG before upload.

## Household and branch-card rule

OTP registration never creates a branch membership and never selects a default branch. `services/customer-household` owns households, members, and household access; its opaque household/member IDs are the cross-service references. Wallet owns the physical card inventory and active assignment for each `(householdId, branchId)`. A household may therefore have a different shared card in each branch, with at most one active card per household/branch and at most one active assignment per physical card. The v1 card is shared by the household and is not bound to an individual member. Moving it between households is an audited same-branch transfer; moving inventory between branches is a separate, unavailable workflow.

Customer visibility is derived from active household access at the Customer & Household owner plus the active Wallet assignment. It is never inferred from OTP signup, a branch picker, or a Gateway-owned card row.

## Family graph and account linking

`services/customer-household` owns family people, household memberships, relationship edges, invitations and household access. The customer family page reads this owner through the authenticated Gateway and derives relationship labels from the signed-in member's graph; names, phone numbers and guessed gender are never used to infer kinship. Old free-text relationship values stay marked for review.

Adding an adult by phone performs exact lookup only in Gateway. Registered users receive an in-app invitation and the proposed relationship is activated only after their explicit acceptance. Unregistered phone invitations and dependent claims use a random, one-time link; the owner stores only its SHA-256 hash. A dependent claim needs OTP-backed account identity and owner/guardian approval. A repeated pending invite returns its existing state; there is no automatic account merge.

Members can update their own displayed information. Owners and guardians can manage dependent records. A relationship change involving another linked adult is rejected until that adult's consent is available. Archiving a dependent or leaving as a non-owner member revokes the related household access and open invitations while keeping audit rows and the household's Wallet assignment. The household owner must transfer ownership before leaving.

Operations and System family support requires `customer.family.read`, exact-phone lookup and the selected organization/branch. It does not require MFA step-up. The Gateway checks current Wallet assignments before asking the owner for a maximum of 25 audit action names and timestamps. These views do not expose phone, birth date, actor IDs or audit payloads and cannot mutate family data. Configuration is documented in `DOCS/RunflareRepositoryAndDeployment.md`.

## API surface

- `GET/PATCH /api/v1/customer/profile`
- `GET/POST /api/v1/customer/profile/avatar`
- Customer household endpoints use the Customer & Household owner through Gateway; Wallet assignments are read through the Wallet API.
- `GET /api/v1/customer/cards` returns cards assigned to households the authenticated customer may access, with masked physical identifier, branch, lifecycle status, and explicit freshness. It does not expose a raw physical identifier, member-specific assignment, balance, or unsourced card history.
- A branch-specific projection is authorized only through a current Wallet assignment for an accessible household; branch discovery alone does not grant customer access.

## Profile ownership and cutover

Customer & Household owns customer profile fields and uploaded avatars in `customer_profiles`; API Gateway continues to own login identity, phone number and sessions. The link is the stable Gateway `userId`, with no cross-schema foreign key. Customer Web keeps the same session-based `/api/v1/customer/profile` routes; Gateway delegates profile reads and writes to the owner and returns avatar bytes only to that authenticated customer.

Migration `services/customer-household/prisma/migrations/0003_customer_profile_owner` is additive. It keeps the Gateway profile columns and `user_avatars` as the rollback source. `CUSTOMER_PROFILE_OWNER_ENABLED=false` leaves Gateway as the only profile writer before cutover; `true` routes reads and writes to Customer & Household. A single Gateway process never writes both owners. The default stays false until the reviewed backfill is complete.

For a controlled cutover, pause customer profile/avatar mutations across all Gateway replicas, deploy the additive Customer & Household schema, and run the one-shot plan with read-only `DATABASE_URL` plus the target owner's migration credential:

```powershell
node scripts/migrations/customer-profile-owner-backfill.mjs
```

Review only counts and checksum. Apply is a separate explicit command and must repeat the reviewed checksum; production requires a one-shot migration environment and `--allow-production`:

```powershell
$env:FUNTINO_ONE_SHOT_MIGRATION = 'true'
node scripts/migrations/customer-profile-owner-backfill.mjs `
  --apply --target-environment production --allow-production `
  --confirm-checksum <reviewed-sha256>
```

This package did not execute that command against production. Resolve every `rejected` profile and repeat dry-run before apply. The tool inserts missing profile rows, never overwrites a Customer & Household row, resumes safely after partial batches, and reports only counts, rejection codes and a checksum. After verifying counts/checksum, change the Gateway flag for every replica in a maintenance window and resume profile mutations. Once new owner writes begin, do not roll back by switching the flag to false: restore the owner snapshot or use a reviewed forward migration, preserving both audit histories.

## Storage and deployment

- Development uses the in-memory adapter and exposes a code only when `NODE_ENV != production` and `EXPOSE_DEV_OTP=true`.
- Before cutover, the Gateway remains the sole profile owner for compatibility. After the flag is enabled, Customer & Household owns profile fields and avatars; the old Gateway columns remain only as migration/rollback source and are not dual-written.
- Production backfill, reconciliation, and profile read/write cutover have not been run. Household, member, and inventory data remain in their owning services and use separate APIs and migrations.
- Production OTP requires a real Parsgreen token in the runtime secret store; it is not included in this repository.
- Before cutover, profile image data remains in the Gateway `user_avatars` table. After cutover it is stored in Customer & Household PostgreSQL as profile-owned avatar data; the private owner API accepts only approved image MIME types and checks image signatures and the 2 MB cap.
- Avatar uploads accept JPEG, PNG and WebP and are capped at 2 MB. The customer UI accepts the original image only as a local crop source, lets the user pan/zoom inside a fixed `1:1` frame, and uploads the resulting square image (512×512 JPEG for the current implementation).
- Birth date is presented as a text-like customer field in the customer UI. Tapping the field opens the Persian calendar picker with day/month/year wheels inside a focused dialog; the wheels are not shown in the form by default. The selected values are converted to the API contract's Gregorian ISO `YYYY-MM-DD` value; no locale-dependent native browser date input is used.
- The server CORS contract explicitly allows the credentialed profile `PATCH` request and its `OPTIONS` preflight: methods are `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`, and the request headers used by the customer client are explicitly allowed.
- Runtime configuration is supplied through `PARSGREEN_API_TOKEN`, `PARSGREEN_AUTH_HEADER`, `PARSGREEN_OTP_URL`, `PARSGREEN_OTP_TEMPLATE_ID`, `PARSGREEN_ADD_NAME` and `PARSGREEN_REQUEST_TIMEOUT_MS`; the production header must be `Authorization`, the endpoint must be the Parsgreen REST OTP endpoint, the template ID must be approved for the account, and the token remains blank in the repository.

## Management surfaces

- `operations-web` exposes the branch-scoped shared-household card assignment workflow: exact verified-phone lookup, masked customer reference, household selection, and audited assign/transfer/cancel. Server-side IAM checks branch scope and distinct permissions; Wallet revalidates card verification/stock, uniqueness and assignment state.
- `system-web` exposes the central identity policy view: OTP adapter status, profile completion policy and the card-only branch rule.
- These two views are intentionally read-only in this slice. Secure mutations require the organization/branch membership matrix, MFA policy and administrator audit scope to be finalized; no fake admin mutation is presented as production behavior.

The customer cards page reads the authenticated cards API and displays the masked physical card, accessible household, branch, assignment/card status and freshness. It does not present a member name because v1 cards are shared at household level. Unknown or stale state remains explicit. Balances, top-ups, spend, device attribution and card history remain excluded until their authoritative owners, event linkage, currency/units and contracts are verified. Source code for the owner services and APIs is present, but a real-data backfill, reconciliation, staging cutover and production rollout remain separate release gates.

## Acceptance checklist

- Wrong, expired, reused and over-attempted OTPs fail safely.
- No real OTP token or code is committed to source control or production logs.
- New signup has `profileCompleted=false`, `activeBranch=null`, and no linked branch.
- A valid card link creates the card/branch relationship and makes that branch eligible for branch-specific data.
- Profile updates and avatar changes are audited.
- Selecting a profile image opens the cropper, the crop frame remains `1:1`, and the uploaded result is square.
- Birth date selection starts with a compact text field, opens day/month/year wheels in a focused picker, keeps the selected item centered in each column, and returns focus to the field after closing.
- Preset-avatar buttons are not rendered while the avatar catalogue is pending design approval.
- `OPTIONS /api/v1/customer/profile` returns `PATCH` in `Access-Control-Allow-Methods` for `https://app.funtino.ir`.
- Customer web typecheck/build and API typecheck/test pass before deployment snapshot generation.
