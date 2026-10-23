ALTER TABLE "Settlement"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "Settlement_idempotencyKey_key"
ON "Settlement" ("idempotencyKey");