CREATE TABLE "CatalogEvent" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT,
  "sellerId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogEvent_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CatalogEvent_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CatalogEvent_resourceId_createdAt_idx" ON "CatalogEvent" ("resourceId", "createdAt");
CREATE INDEX "CatalogEvent_sellerId_createdAt_idx" ON "CatalogEvent" ("sellerId", "createdAt");
CREATE INDEX "CatalogEvent_type_status_idx" ON "CatalogEvent" ("type", "status");

CREATE TABLE "McpServer" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT,
  "name" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpServer_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "McpServer_sellerId_status_idx" ON "McpServer" ("sellerId", "status");

CREATE TABLE "McpTool" (
  "id" TEXT NOT NULL,
  "serverId" TEXT NOT NULL,
  "resourceId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "inputSchema" JSONB NOT NULL,
  "outputSchema" JSONB NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpTool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpTool_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "McpTool_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "McpTool_serverId_name_key" ON "McpTool" ("serverId", "name");
CREATE INDEX "McpTool_resourceId_idx" ON "McpTool" ("resourceId");

CREATE TABLE "SearchDocument" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "ranking" JSONB NOT NULL,
  "indexedAt" TIMESTAMPTZ,
  "stale" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "SearchDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchDocument_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SearchDocument_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SearchDocument_resourceId_key" ON "SearchDocument" ("resourceId");
CREATE INDEX "SearchDocument_sellerId_idx" ON "SearchDocument" ("sellerId");
CREATE INDEX "SearchDocument_stale_idx" ON "SearchDocument" ("stale");
CREATE INDEX "SearchDocument_body_fts_idx" ON "SearchDocument" USING GIN (to_tsvector('english', "body"));

CREATE TABLE "ConformanceRun" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "suite" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "results" JSONB NOT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConformanceRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConformanceRun_network_status_idx" ON "ConformanceRun" ("network", "status");
CREATE INDEX "ConformanceRun_createdAt_idx" ON "ConformanceRun" ("createdAt");

CREATE TABLE "NetworkStatus" (
  "id" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "latestLedger" INTEGER,
  "rpcHealthy" BOOLEAN NOT NULL DEFAULT false,
  "horizonHealthy" BOOLEAN NOT NULL DEFAULT false,
  "checkedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL,
  CONSTRAINT "NetworkStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetworkStatus_network_key" ON "NetworkStatus" ("network");
CREATE INDEX "NetworkStatus_status_idx" ON "NetworkStatus" ("status");

CREATE TABLE "ApiClient" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "publicKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "rateLimitTier" TEXT NOT NULL DEFAULT 'default',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiClient_publicKey_key" ON "ApiClient" ("publicKey");
CREATE INDEX "ApiClient_status_rateLimitTier_idx" ON "ApiClient" ("status", "rateLimitTier");

CREATE TABLE "RateLimitEvent" (
  "id" TEXT NOT NULL,
  "apiClientId" TEXT,
  "route" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "limit" INTEGER NOT NULL,
  "remaining" INTEGER NOT NULL,
  "resetAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateLimitEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RateLimitEvent_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "RateLimitEvent_apiClientId_createdAt_idx" ON "RateLimitEvent" ("apiClientId", "createdAt");
CREATE INDEX "RateLimitEvent_route_createdAt_idx" ON "RateLimitEvent" ("route", "createdAt");
CREATE INDEX "RateLimitEvent_key_createdAt_idx" ON "RateLimitEvent" ("key", "createdAt");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_actorType_actorId_idx" ON "AuditLog" ("actorType", "actorId");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog" ("targetType", "targetId");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog" ("action", "createdAt");

CREATE TABLE "OperatorConfig" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "OperatorConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorConfig_key_key" ON "OperatorConfig" ("key");
