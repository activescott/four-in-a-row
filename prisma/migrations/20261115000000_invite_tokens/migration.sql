-- No code created an invite before this migration, so no row can be a live
-- invite. Clear any stray one, so the NOT NULL columns can't fail the deploy.
DELETE FROM "invites";

-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "expires_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "token_hash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_inviter_id_idx" ON "invites"("inviter_id");
