-- Catalog moderation and quarantine workflow.
--
-- Moderation state is additive: seller-authored metadata and version records
-- are never rewritten or deleted. Quarantined versions are excluded from
-- discovery and search while remaining visible to the owning seller and
-- operators.

ALTER TABLE "Resource"
  ADD COLUMN "moderationState" TEXT NOT NULL DEFAULT 'visible';

ALTER TABLE "ResourceVersion"
  ADD COLUMN "moderationState" TEXT NOT NULL DEFAULT 'visible',
  ADD COLUMN "quarantineReasonCode" TEXT,
  ADD COLUMN "quarantinedAt" TIMESTAMPTZ;

ALTER TABLE "SearchDocument"
  ADD COLUMN "moderationState" TEXT NOT NULL DEFAULT 'visible';

CREATE INDEX "Resource_moderationState_status_idx"
  ON "Resource" ("moderationState", "status");

CREATE INDEX "ResourceVersion_resourceId_moderationState_idx"
  ON "ResourceVersion" ("resourceId", "moderationState");

CREATE INDEX "SearchDocument_moderationState_idx"
  ON "SearchDocument" ("moderationState");

CREATE TABLE "ResourceModerationAction" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "resultingState" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "evidenceRefs" JSONB NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "reviewerType" TEXT NOT NULL DEFAULT 'operator',
  "notes" TEXT,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourceModerationAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceModerationAction_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourceModerationAction_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ResourceVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ResourceModerationAction_resourceId_createdAt_idx"
  ON "ResourceModerationAction" ("resourceId", "createdAt");
CREATE INDEX "ResourceModerationAction_resourceId_version_createdAt_idx"
  ON "ResourceModerationAction" ("resourceId", "version", "createdAt");
CREATE INDEX "ResourceModerationAction_action_createdAt_idx"
  ON "ResourceModerationAction" ("action", "createdAt");
CREATE INDEX "ResourceModerationAction_reviewerId_createdAt_idx"
  ON "ResourceModerationAction" ("reviewerId", "createdAt");

CREATE TABLE "ModerationNotification" (
  "id" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "channel" TEXT NOT NULL DEFAULT 'in_app',
  "notifiedAt" TIMESTAMPTZ,
  "failureReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ModerationNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationNotification_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "ResourceModerationAction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ModerationNotification_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ModerationNotification_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ModerationNotification_actionId_key"
  ON "ModerationNotification" ("actionId");
CREATE INDEX "ModerationNotification_sellerId_status_idx"
  ON "ModerationNotification" ("sellerId", "status");
CREATE INDEX "ModerationNotification_resourceId_createdAt_idx"
  ON "ModerationNotification" ("resourceId", "createdAt");

-- Moderation actions are an append-only audit trail. The application never
-- exposes update/delete paths, and the database enforces the same invariant so
-- an accidental query cannot rewrite history.
CREATE OR REPLACE FUNCTION "prevent_moderation_action_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ResourceModerationAction records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResourceModerationAction_immutable"
  BEFORE UPDATE OR DELETE ON "ResourceModerationAction"
  FOR EACH ROW EXECUTE FUNCTION "prevent_moderation_action_mutation"();
