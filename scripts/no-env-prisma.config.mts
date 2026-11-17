// A Prisma config that, unlike prisma.config.mts, does not set CHECKPOINT_DISABLE.
// check-no-checkpoint.mjs passes it with --config to stand in for a CLI run that
// never loaded the repo's config (another cwd, or a checkout from before it did).
import { defineConfig } from "prisma/config";

export default defineConfig({ schema: "prisma/schema.prisma" });
