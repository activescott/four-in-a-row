-- The limits count under a bucket key (the address without a +tag, and for
-- Gmail without dots), while `address` stays the one the mail went to.
ALTER TABLE "email_sends" ADD COLUMN "bucket" TEXT;
UPDATE "email_sends" SET "bucket" = "address";
ALTER TABLE "email_sends" ALTER COLUMN "bucket" SET NOT NULL;

-- DropIndex
DROP INDEX "email_sends_address_created_at_idx";

-- CreateIndex
CREATE INDEX "email_sends_bucket_created_at_idx" ON "email_sends"("bucket", "created_at");
