# Funtino Frontend Runtime

This self-contained runtime snapshot contains the customer, operations and system Next.js apps. It starts three Node processes in one Runflare Docker item:

- Customer Web: port 3000, app.funtino.ir
- Operations Web: port 3001, web.funtino.ir
- System Web: port 3002, admin.funtino.ir

Build from this repository root with Docker. The Dockerfile pins Node.js 22 and pnpm 10.12.4, installs the pruned workspace, builds all three apps and runs the manifest-driven supervisor. Container health requires all three ports to accept connections.

NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_DATA_MODE and NEXT_PUBLIC_CUSTOMER_WEB_URL are public build-time values. The customer URL is used to create form share links and defaults to https://app.funtino.ir. Do not put credentials in Docker build arguments. The supervisor gives each process only its allow-listed environment; it stops the other apps if any child exits.

This repository is generated from the Funtino source monorepo. Make feature changes in source, then regenerate this snapshot. It is not a separate source of truth. Runflare GitHub, branch, Auto Pull, domains, resources and TLS must be configured and confirmed separately.
