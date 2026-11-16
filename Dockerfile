# syntax=docker/dockerfile:1
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS base
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
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json prisma.config.mts server.mjs docker-entrypoint.sh ./
COPY prisma ./prisma
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
