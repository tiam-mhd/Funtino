# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

ARG NPM_REGISTRY=https://mirror-npm.runflare.com
ARG APP_VERSION=unknown
ARG NEXT_PUBLIC_API_BASE_URL=https://api.funtino.ir
ARG NEXT_PUBLIC_DATA_MODE=api

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_DATA_MODE=${NEXT_PUBLIC_DATA_MODE}

WORKDIR /app

RUN npm install --global pnpm@10.12.4 --registry="${NPM_REGISTRY}" \
    && pnpm config set registry "${NPM_REGISTRY}" \
    && pnpm --version

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm exec turbo run build \
      --filter=@funtino/customer-web \
      --filter=@funtino/operations-web \
      --filter=@funtino/system-web \
      --concurrency=1 \
    && node -e "const fs=require('node:fs'); for (const p of ['apps/customer-web/.next/BUILD_ID','apps/operations-web/.next/BUILD_ID','apps/system-web/.next/BUILD_ID']) fs.accessSync(p)"

ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}

EXPOSE 3000 3001 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD ["node", "runtime/healthcheck.mjs", "runtime/frontend.processes.json"]

RUN chown -R node:node /app
USER node

CMD ["node", "runtime/supervisor.mjs", "runtime/frontend.processes.json"]
