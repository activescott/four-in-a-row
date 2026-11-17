# syntax=docker/dockerfile:1
FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
# The Prisma schema engine links against OpenSSL, which the slim image lacks.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# --omit=optional: @prisma/client lists the CLI as an optional peer, which keeps it.
RUN npx prisma generate && npm run build && npm prune --omit=dev --omit=optional

# Init container image: the Prisma CLI and the migrations, nothing else.
FROM base AS migrate
ENV NODE_ENV=production \
  CHECKPOINT_DISABLE=1 \
  PRISMA_HIDE_UPDATE_MESSAGE=1
COPY package.json package-lock.json ./
# The CLI is a devDependency, which NODE_ENV=production would skip.
RUN npm ci --include=dev
COPY prisma.config.mts ./
COPY prisma ./prisma
USER node
ENTRYPOINT ["node_modules/.bin/prisma", "migrate", "deploy"]

# Last stage, so it stays the default target.
FROM base
ENV NODE_ENV=production \
  PORT=3000 \
  CHECKPOINT_DISABLE=1 \
  PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json server.mjs docker-entrypoint.sh ./
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
