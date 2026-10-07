ALTER TABLE "PaymentAttempt" ADD COLUMN "correlationId" VARCHAR(64);
UPDATE "PaymentAttempt" SET "correlationId" = 'legacy_' || "id" WHERE "correlationId" IS NULL;
ALTER TABLE "PaymentAttempt" ALTER COLUMN "correlationId" SET NOT NULL;

ALTER TABLE "Settlement" ADD COLUMN "correlationId" VARCHAR(64);
UPDATE "Settlement" AS settlement
SET "correlationId" = attempt."correlationId"
FROM "PaymentAttempt" AS attempt
WHERE settlement."paymentAttemptId" = attempt."id";
ALTER TABLE "Settlement" ALTER COLUMN "correlationId" SET NOT NULL;

ALTER TABLE "Receipt" ADD COLUMN "correlationId" VARCHAR(64);
UPDATE "Receipt" AS receipt
SET "correlationId" = attempt."correlationId"
FROM "PaymentAttempt" AS attempt
WHERE receipt."paymentAttemptId" = attempt."id";
ALTER TABLE "Receipt" ALTER COLUMN "correlationId" SET NOT NULL;

ALTER TABLE "AuditLog" ADD COLUMN "correlationId" VARCHAR(64);

CREATE INDEX "PaymentAttempt_correlationId_idx" ON "PaymentAttempt" ("correlationId");
CREATE INDEX "Settlement_correlationId_idx" ON "Settlement" ("correlationId");
CREATE INDEX "Receipt_correlationId_idx" ON "Receipt" ("correlationId");
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog" ("correlationId");
