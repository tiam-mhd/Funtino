# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && openssl version \
    && rm -rf /var/lib/apt/lists/*

ARG NPM_REGISTRY=https://mirror-npm.runflare.com

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /app

RUN npm install --global pnpm@10.12.4 --registry="${NPM_REGISTRY}" \
    && pnpm config set registry "${NPM_REGISTRY}" \
    && pnpm --version

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm build \
    && node -e "require('node:fs').accessSync('services/customer-household/dist/main.js'); require('node:fs').accessSync('scripts/worker-startup.mjs')"

ENV NODE_ENV=production
ENV CUSTOMER_HOUSEHOLD_PORT=4080

EXPOSE 4080

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 CMD node -e "fetch('http://127.0.0.1:4080/health/live').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

RUN chown -R node:node /app
USER node

WORKDIR /app/services/customer-household

CMD ["node", "/app/scripts/worker-startup.mjs", "customer-household", "dist/main.js"]
