ALTER TABLE "Settlement"
ADD COLUMN "reconciliationReason" TEXT,
ADD COLUMN "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastReconciledAt" TIMESTAMPTZ;

CREATE INDEX "Settlement_reconciliationState_lastReconciledAt_idx"
ON "Settlement" ("reconciliationState", "lastReconciledAt");
