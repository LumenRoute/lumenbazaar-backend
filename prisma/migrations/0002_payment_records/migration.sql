CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "resourceId" TEXT,
  "sellerId" TEXT,
  "paymentHash" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "assetIssuer" TEXT NOT NULL,
  "amount" NUMERIC(24, 7) NOT NULL,
  "payTo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "failureCode" TEXT,
  "failureReason" TEXT,
  "expiresAtLedger" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttempt_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PaymentAttempt_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PaymentAttempt_paymentHash_key" ON "PaymentAttempt" ("paymentHash");
CREATE INDEX "PaymentAttempt_network_status_idx" ON "PaymentAttempt" ("network", "status");
CREATE INDEX "PaymentAttempt_sellerId_status_idx" ON "PaymentAttempt" ("sellerId", "status");
CREATE INDEX "PaymentAttempt_resourceId_status_idx" ON "PaymentAttempt" ("resourceId", "status");

CREATE TABLE "Settlement" (
  "id" TEXT NOT NULL,
  "paymentAttemptId" TEXT NOT NULL,
  "transactionHash" TEXT,
  "ledger" INTEGER,
  "network" TEXT NOT NULL,
  "amount" NUMERIC(24, 7) NOT NULL,
  "assetCode" TEXT NOT NULL,
  "assetIssuer" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "settledAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Settlement_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Settlement_paymentAttemptId_key" ON "Settlement" ("paymentAttemptId");
CREATE UNIQUE INDEX "Settlement_transactionHash_key" ON "Settlement" ("transactionHash");
CREATE INDEX "Settlement_network_status_idx" ON "Settlement" ("network", "status");
CREATE INDEX "Settlement_ledger_idx" ON "Settlement" ("ledger");

CREATE TABLE "Receipt" (
  "id" TEXT NOT NULL,
  "paymentAttemptId" TEXT NOT NULL,
  "resourceId" TEXT,
  "sellerId" TEXT,
  "transactionHash" TEXT,
  "ledger" INTEGER,
  "network" TEXT NOT NULL,
  "amount" NUMERIC(24, 7) NOT NULL,
  "assetCode" TEXT NOT NULL,
  "assetIssuer" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "settledAt" TIMESTAMPTZ,
  "failureCode" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Receipt_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Receipt_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Receipt_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Receipt_paymentAttemptId_key" ON "Receipt" ("paymentAttemptId");
CREATE INDEX "Receipt_network_status_idx" ON "Receipt" ("network", "status");
CREATE INDEX "Receipt_sellerId_status_idx" ON "Receipt" ("sellerId", "status");
CREATE INDEX "Receipt_resourceId_status_idx" ON "Receipt" ("resourceId", "status");
CREATE INDEX "Receipt_transactionHash_idx" ON "Receipt" ("transactionHash");
