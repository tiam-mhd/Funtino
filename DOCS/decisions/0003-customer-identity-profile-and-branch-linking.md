# ADR 0003 — Customer identity, profile completion and card-based branch linking

Date: 2026-09-27
Status: Accepted

## Context

The customer app is the first executable product surface. Customers authenticate with an Iranian mobile number through a one-time password, but a new account must not be assigned to a branch before the customer has a card issued by that branch. The app also needs a durable profile and a small profile image/avatar without depending on an ephemeral container filesystem.

## Decisions

1. OTP delivery is behind the `OtpSender` port. `ParsGreenOtpSender` generates the six-digit code locally, sends it through Parsgreen's REST OTP endpoint (`/Apiv2/Message/SendOtp`) with the `Authorization: basic apikey:<token>` contract, and the API verifies the hashed challenge locally. The endpoint and account-approved template ID remain runtime configuration; the Parsgreen token is never stored in source control.
   A timeout after the send attempt is an ambiguous delivery outcome: the challenge is retained, `deliveryStatus` is `unknown`, and the client must not retry automatically.
2. In non-production without a token, the adapter intentionally falls back to a local sender for development. In production without a token, it fails closed with `DEPENDENCY_UNAVAILABLE`.
3. A successful OTP verification creates or retrieves only a `User` and a session. It never creates a branch membership, selects an active branch, or assigns a household.
4. `Card.branchId` is required by the customer link API. The customer’s linked branches are derived from cards in their household; branch-specific missions require a linked branch.
5. Profile fields live on `users`. A single small avatar is stored in PostgreSQL as `user_avatars.data` (`bytea`) for the MVP. The adapter boundary allows a future object-storage implementation without changing the customer API.
6. Profile completion requires first name, last name, birth date, gender, city, and either an uploaded image or an approved preset avatar. Until completion, the customer shell shows onboarding and does not expose the main navigation.

## Consequences

- Runflare production must define `PARSGREEN_API_TOKEN` and any account-specific endpoint/header settings as secrets/configuration.
- The first migration adds nullable `cards.branch_id` so existing records remain readable; all new customer card-link requests must provide a valid active branch.
- Image uploads are intentionally capped at 2 MB and limited to JPEG, PNG and WebP.
- Branch discovery remains public, while branch-specific customer data is protected by card ownership.

## Verification

- API typecheck and Prisma validation must pass.
- The core flow test covers OTP, incomplete/complete profile, no branch before card, and branch activation after card linking.
- Customer web typecheck must pass and the browser flow must be checked with the API running in memory mode before connecting production Parsgreen credentials.
