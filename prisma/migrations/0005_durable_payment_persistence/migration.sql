ALTER TABLE "PaymentAttempt" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "PaymentAttempt"
SET "idempotencyKey" = 'verify:' || "paymentHash"
WHERE "idempotencyKey" IS NULL;
ALTER TABLE "PaymentAttempt" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt" ("idempotencyKey");

ALTER TABLE "Settlement"
ADD COLUMN "reconciliationState" TEXT NOT NULL DEFAULT 'not_required';

ALTER TABLE "Receipt" ADD COLUMN "evidenceHash" TEXT;
UPDATE "Receipt"
SET "evidenceHash" = md5(
  "id" || ':' || "paymentAttemptId" || ':' || COALESCE("transactionHash", '') || ':' || COALESCE("ledger"::TEXT, '')
)
WHERE "evidenceHash" IS NULL;
ALTER TABLE "Receipt" ALTER COLUMN "evidenceHash" SET NOT NULL;
CREATE UNIQUE INDEX "Receipt_evidenceHash_key" ON "Receipt" ("evidenceHash");

ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_paymentAttemptId_fkey";
ALTER TABLE "Settlement"
ADD CONSTRAINT "Settlement_paymentAttemptId_fkey"
FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Receipt" DROP CONSTRAINT "Receipt_paymentAttemptId_fkey";
ALTER TABLE "Receipt"
ADD CONSTRAINT "Receipt_paymentAttemptId_fkey"
FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
