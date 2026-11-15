-- No code has created an invite before this migration, so the table is empty
-- and the new columns can be NOT NULL without a default.

-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "expires_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "token_hash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_inviter_id_idx" ON "invites"("inviter_id");
