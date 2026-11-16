-- CreateTable
CREATE TABLE "email_sends" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_sends_address_created_at_idx" ON "email_sends"("address", "created_at");

-- CreateIndex
CREATE INDEX "email_sends_created_at_idx" ON "email_sends"("created_at");
