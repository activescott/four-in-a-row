// Stop the Prisma CLI calling checkpoint.prisma.io (telemetry and version check).
// Every CLI command loads this file, so this covers direct `npx prisma` calls too.
process.env.CHECKPOINT_DISABLE ??= "1";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Only `prisma migrate deploy` needs a URL; generate works without one.
  // `migrate diff --from-migrations` (CI) also needs a shadow database.
  ...(process.env.DATABASE_URL && {
    datasource: {
      url: process.env.DATABASE_URL,
      ...(process.env.SHADOW_DATABASE_URL && {
        shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
      }),
    },
  }),
});
