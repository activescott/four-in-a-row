import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Only `prisma migrate deploy` needs a URL; generate and diff work without one.
  ...(process.env.DATABASE_URL && {
    datasource: { url: process.env.DATABASE_URL },
  }),
});
