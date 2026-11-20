-- Note: PaymentAttempt table and unique constraints already exist in schema.
-- This migration documents the replay-protection uniqueness guarantees.
-- No new columns needed; unique constraint on paymentHash is already defined in schema.

-- Verify unique constraint exists for paymentHash (atomic duplicate detection)
-- If recreating from scratch, ensure:
-- CREATE UNIQUE INDEX "PaymentAttempt_paymentHash_key" ON "PaymentAttempt"("paymentHash");
-- CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");

-- Add index for efficient hash lookups if not present
CREATE INDEX IF NOT EXISTS "PaymentAttempt_paymentHash_idx" ON "PaymentAttempt"("paymentHash");

-- Add composite index for settlement lookups
CREATE INDEX IF NOT EXISTS "PaymentAttempt_status_createdAt_idx" ON "PaymentAttempt"("status", "createdAt");
