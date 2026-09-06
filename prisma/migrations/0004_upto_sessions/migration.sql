CREATE TABLE "PaymentSession" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT,
  "sellerId" TEXT,
  "network" TEXT NOT NULL,
  "buyer" TEXT NOT NULL,
  "payTo" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "assetIssuer" TEXT NOT NULL,
  "assetContractId" TEXT NOT NULL,
  "capAmount" DECIMAL(24, 7) NOT NULL,
  "spentAmount" DECIMAL(24, 7) NOT NULL,
  "remainingAmount" DECIMAL(24, 7) NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractSessionId" TEXT NOT NULL,
  "resourceHash" TEXT NOT NULL,
  "expiresAtLedger" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "transactionHash" TEXT,
  "ledger" INTEGER,
  "usageHash" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "PaymentSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentSession_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PaymentSession_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PaymentSession_contractSessionId_key" ON "PaymentSession" ("contractSessionId");
CREATE INDEX "PaymentSession_network_status_idx" ON "PaymentSession" ("network", "status");
CREATE INDEX "PaymentSession_sellerId_status_idx" ON "PaymentSession" ("sellerId", "status");
CREATE INDEX "PaymentSession_resourceId_status_idx" ON "PaymentSession" ("resourceId", "status");
CREATE INDEX "PaymentSession_contractId_idx" ON "PaymentSession" ("contractId");
CREATE INDEX "PaymentSession_expiresAtLedger_idx" ON "PaymentSession" ("expiresAtLedger");

CREATE TABLE "UptoSessionSettlement" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "amount" DECIMAL(24, 7) NOT NULL,
  "transactionHash" TEXT NOT NULL,
  "ledger" INTEGER NOT NULL,
  "usageHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'settled',
  "settledAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UptoSessionSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UptoSessionSettlement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaymentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UptoSessionSettlement_transactionHash_key" ON "UptoSessionSettlement" ("transactionHash");
CREATE INDEX "UptoSessionSettlement_sessionId_createdAt_idx" ON "UptoSessionSettlement" ("sessionId", "createdAt");
CREATE INDEX "UptoSessionSettlement_network_status_idx" ON "UptoSessionSettlement" ("network", "status");
CREATE INDEX "UptoSessionSettlement_ledger_idx" ON "UptoSessionSettlement" ("ledger");
CREATE INDEX "UptoSessionSettlement_usageHash_idx" ON "UptoSessionSettlement" ("usageHash");
