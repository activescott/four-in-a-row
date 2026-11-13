# syntax=docker/dockerfile:1
FROM node:24-slim AS base
# The Prisma schema engine links against OpenSSL, which the slim image lacks.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM base
ENV NODE_ENV=production \
  PORT=3000 \
  CHECKPOINT_DISABLE=1 \
  PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node package.json prisma.config.mts server.mjs docker-entrypoint.sh ./
COPY --chown=node:node prisma ./prisma
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
