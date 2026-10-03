# Funtino Backend Runtime

This self-contained runtime snapshot contains two gateways and seven backend services. It starts nine Node processes in one Runflare Docker item:

- API Gateway: 4000, public at api.funtino.ir
- Realtime Gateway: 4010, public at realtime.funtino.ir with Socket.IO/WebSocket enabled
- Device Integration: 4020, private
- Notifications: 4030, private
- Identity & Access: 4040, private
- Organization & Branch: 4050, private
- Analytics Read Model: 4060, private
- Wallet: 4070, private
- Customer & Household: 4080, private

Build from this repository root with Docker. The Dockerfile pins Node.js 22 and pnpm 10.12.4, installs OpenSSL for Prisma, builds all backend workspaces and starts the manifest-driven supervisor. Container health requires all nine ports to accept connections.

The supervisor passes only allow-listed variables to each child. Runtime Secrets stay in Runflare. Use the per-process keys in .env.example and the process manifest. Do not send DATABASE_MIGRATION_URL to the API runtime process; use the separate, controlled API migration job. The five Worker startup migrations described in ADR-0015 are the only migrations run by child startup.

This repository is generated from the Funtino source monorepo. Make feature changes in source, then regenerate this snapshot. It is not a separate source of truth. Runflare internal HTTPS routes, public domains, branch, Auto Pull, resources, Secrets, health and WebSocket must be configured and confirmed separately.
