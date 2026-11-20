-- Add soft-delete fields to Resource model
ALTER TABLE "Resource" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedBy" TEXT,
ADD COLUMN "restoreDeadline" TIMESTAMP(3),
ADD COLUMN "purgedAt" TIMESTAMP(3);

-- Create indexes for soft-delete queries
CREATE INDEX "Resource_deletedAt_idx" ON "Resource"("deletedAt");
CREATE INDEX "Resource_restoreDeadline_idx" ON "Resource"("restoreDeadline");
CREATE INDEX "Resource_status_restoreDeadline_idx" ON "Resource"("status", "restoreDeadline");
