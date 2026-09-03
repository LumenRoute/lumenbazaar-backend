CREATE TABLE "Seller" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "domainVerifiedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Seller_walletAddress_key" ON "Seller" ("walletAddress");
CREATE INDEX "Seller_domain_idx" ON "Seller" ("domain");

CREATE TABLE "SellerDomain" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "verificationMethod" TEXT NOT NULL,
  "challengeToken" TEXT NOT NULL,
  "verifiedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "SellerDomain_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SellerDomain_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SellerDomain_sellerId_domain_key" ON "SellerDomain" ("sellerId", "domain");
CREATE INDEX "SellerDomain_domain_idx" ON "SellerDomain" ("domain");

CREATE TABLE "Resource" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "routeTemplate" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "payTo" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "assetIssuer" TEXT NOT NULL,
  "amount" NUMERIC(24, 7) NOT NULL,
  "inputSchema" JSONB NOT NULL,
  "outputSchema" JSONB NOT NULL,
  "extensions" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "Resource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Resource_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Resource_sellerId_idx" ON "Resource" ("sellerId");
CREATE INDEX "Resource_network_assetCode_idx" ON "Resource" ("network", "assetCode");
CREATE INDEX "Resource_type_status_idx" ON "Resource" ("type", "status");

CREATE TABLE "ResourceVersion" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourceVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceVersion_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ResourceVersion_resourceId_version_key" ON "ResourceVersion" ("resourceId", "version");

CREATE TABLE "ResourceSchema" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "inputSchema" JSONB NOT NULL,
  "outputSchema" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourceSchema_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceSchema_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PaymentRequirement" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "scheme" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "assetIssuer" TEXT NOT NULL,
  "amount" NUMERIC(24, 7) NOT NULL,
  "payTo" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRequirement_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PaymentRequirement_network_assetCode_idx" ON "PaymentRequirement" ("network", "assetCode");
CREATE INDEX "PaymentRequirement_payTo_idx" ON "PaymentRequirement" ("payTo");
