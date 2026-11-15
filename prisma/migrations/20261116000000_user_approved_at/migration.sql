-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approved_at" TIMESTAMP(3);

-- Every account before this migration signed in through the gate or was
-- seeded, so each one is approved.
UPDATE "users" SET "approved_at" = "created_at";
