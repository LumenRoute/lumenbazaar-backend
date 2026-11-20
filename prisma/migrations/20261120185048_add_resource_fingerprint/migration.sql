-- Resource Fingerprint Detection for Duplicate Catalog Entries
--
-- Tracks canonical fingerprints of resources to detect semantically duplicate
-- resources published under minor metadata changes.
--
-- Fingerprint inputs (v1):
-- - sellerId: canonical seller, immutable
-- - url: canonical endpoint URL
-- - network: Stellar network (testnet, pubnet)
-- - assetCode: asset code
-- - assetIssuer: Stellar account ID
-- - amount: exact payment amount
-- - payTo: payment destination
--
-- The fingerprint is versioned to allow algorithm updates without breaking
-- existing detections. Currently v1.

CREATE TABLE "ResourceFingerprint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "resourceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "hash" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resource" "Resource"("id") ON DELETE CASCADE,

  CONSTRAINT "ResourceFingerprint_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE CASCADE
);

-- Unique fingerprint per resource: only one fingerprint per resource
CREATE UNIQUE INDEX "ResourceFingerprint_resourceId_key" ON "ResourceFingerprint" ("resourceId");

-- Index by hash and version for collision detection queries
CREATE INDEX "ResourceFingerprint_hash_version_idx" ON "ResourceFingerprint" ("hash", "version");

-- Index by creation time for auditing and pagination
CREATE INDEX "ResourceFingerprint_createdAt_idx" ON "ResourceFingerprint" ("createdAt");

-- Table to track flagged duplicate collisions for moderation review
-- Flagged duplicates are never automatically deleted; moderation teams review and take action
CREATE TABLE "ResourceDuplicateFlag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "resourceId" TEXT NOT NULL,
  "collidingResourceIds" TEXT NOT NULL, -- JSON array of colliding resource IDs
  "fingerprintHash" TEXT NOT NULL,
  "fingerprintVersion" INTEGER NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'high', -- 'high', 'medium', 'low'
  "status" TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'reviewed', 'dismissed', 'resolved'
  "reviewedAt" TIMESTAMP,
  "reviewedBy" TEXT, -- Seller ID or admin ID of reviewer
  "resolution" TEXT, -- Free text note on resolution
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resource" "Resource"("id") ON DELETE CASCADE,

  CONSTRAINT "ResourceDuplicateFlag_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE CASCADE
);

-- Index by resource for finding all flags for a resource
CREATE INDEX "ResourceDuplicateFlag_resourceId_idx" ON "ResourceDuplicateFlag" ("resourceId");

-- Index by fingerprint hash for finding all collisions
CREATE INDEX "ResourceDuplicateFlag_fingerprintHash_idx" ON "ResourceDuplicateFlag" ("fingerprintHash");

-- Index by status for moderation workflow queries
CREATE INDEX "ResourceDuplicateFlag_status_createdAt_idx" ON "ResourceDuplicateFlag" ("status", "createdAt");

-- Index by creation time for auditing and pagination
CREATE INDEX "ResourceDuplicateFlag_createdAt_idx" ON "ResourceDuplicateFlag" ("createdAt");
