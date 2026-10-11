# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

ARG NPM_REGISTRY=https://mirror-npm.runflare.com
ARG APP_VERSION=unknown

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /app

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && openssl version \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.12.4 --registry="${NPM_REGISTRY}" \
    && pnpm config set registry "${NPM_REGISTRY}" \
    && pnpm --version

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm backend:build \
    && node -e "const fs=require('node:fs'); for (const p of ['apps/api-gateway/dist/main.js','apps/realtime-gateway/dist/main.js','services/device-integration/dist/main.js','services/notifications/dist/main.js','services/identity-access/dist/main.js','services/organization-branch/dist/main.js','services/analytics-read-model/dist/main.js','services/wallet/dist/main.js','services/customer-household/dist/main.js','services/forms/dist/main.js','scripts/worker-startup.mjs','runtime/supervisor.mjs','runtime/healthcheck.mjs','runtime/backend.processes.json']) fs.accessSync(p)"

ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}

EXPOSE 4000 4010 4020 4030 4040 4050 4060 4070 4080 4090

HEALTHCHECK --interval=30s --timeout=10s --start-period=20m --retries=3 CMD ["node", "runtime/healthcheck.mjs", "runtime/backend.processes.json"]

RUN chown -R node:node /app
USER node

CMD ["node", "runtime/supervisor.mjs", "runtime/backend.processes.json"]
