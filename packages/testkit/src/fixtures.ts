import { localIssuerPublicKey, type JsonObject } from "@lumenbazaar/shared";

/**
 * Test fixtures for LumenBazaar testing
 */

export const testnetConfig = {
  network: "stellar:testnet" as const,
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org"
};

export const pubnetConfig = {
  network: "stellar:pubnet" as const,
  rpcUrl: "https://mainnet.sorobanrpc.com",
  horizonUrl: "https://horizon.stellar.org"
};

/**
 * Test seller fixture
 */
export const testSeller = {
  id: "seller_test_001",
  displayName: "Test Seller",
  walletAddress: "GDZST3XVCDTUJ76ZAV2HA72KYRTYKYI6YLJVMQ5DNPMJR7BKQW5EBXM",
  domain: "test.example.com",
  domainVerifiedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * Test resource fixture
 */
export const testResource = {
  id: "resource_test_001",
  sellerId: testSeller.id,
  type: "http" as const,
  name: "Test Weather API",
  description: "A test weather API endpoint",
  url: "https://api.test.example.com",
  routeTemplate: "/weather/{city}",
  network: testnetConfig.network,
  payTo: testSeller.walletAddress,
  assetCode: "USDC",
  assetIssuer: "GDZST3XVCDTUJ76ZAV2HA72KYRTYKYI6YLJVMQ5DNPMJR7BKQW5EBXM",
  amount: "1000000", // 0.1 USDC in stroops
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string" }
    },
    required: ["city"]
  } as JsonObject,
  outputSchema: {
    type: "object",
    properties: {
      temperature: { type: "number" },
      condition: { type: "string" }
    }
  } as JsonObject,
  extensions: {
    trusted: true
  } as JsonObject,
  status: "active",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * Test payment attempt fixture
 */
export const testPaymentAttempt = {
  id: "attempt_test_001",
  resourceId: testResource.id,
  sellerId: testSeller.id,
  paymentHash: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  idempotencyKey: "verify:a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  network: testnetConfig.network,
  assetCode: "USDC",
  assetIssuer: testResource.assetIssuer,
  amount: testResource.amount,
  payTo: testResource.payTo,
  status: "received",
  failureCode: null,
  failureReason: null,
  expiresAtLedger: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * Test settlement fixture
 */
export const testSettlement = {
  id: "settlement_test_001",
  paymentAttemptId: testPaymentAttempt.id,
  transactionHash: "ca9f5c85cf0a6a97c91a89a9a01c8b2c1c8c0fa3c8d8c1c8c1c8c1c8c1c8c",
  ledger: 12345678,
  network: testnetConfig.network,
  amount: testPaymentAttempt.amount,
  assetCode: testPaymentAttempt.assetCode,
  assetIssuer: testPaymentAttempt.assetIssuer,
  status: "confirmed",
  reconciliationState: "not_required",
  settledAt: new Date().toISOString(),
  createdAt: new Date().toISOString()
};

/**
 * Test receipt fixture
 */
export const testReceipt = {
  id: "receipt_test_001",
  paymentAttemptId: testPaymentAttempt.id,
  resourceId: testResource.id,
  sellerId: testSeller.id,
  transactionHash: testSettlement.transactionHash,
  ledger: testSettlement.ledger,
  network: testnetConfig.network,
  amount: testPaymentAttempt.amount,
  assetCode: testPaymentAttempt.assetCode,
  assetIssuer: testPaymentAttempt.assetIssuer,
  status: "finalized",
  settledAt: testSettlement.settledAt,
  failureCode: null,
  failureReason: null,
  evidenceHash: "receipt-evidence-fixture",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * Test payment payload fixture
 */
export const testAssetContractId = "CB256KDRXDO2FYJN3YBYZE5KCU46WIIE67DRP5T7HI45DRH2GM6YOJFS";

/**
 * Test payment requirement fixture
 */
export const testPaymentRequirement = {
  scheme: "exact" as const,
  network: testnetConfig.network,
  asset: testAssetContractId,
  amount: "500000",
  payTo: localIssuerPublicKey,
  maxTimeoutSeconds: 60,
  extra: {
    assetCode: testResource.assetCode,
    assetIssuer: testResource.assetIssuer
  }
};

export const testPaymentPayload = {
  x402Version: 2 as const,
  accepted: testPaymentRequirement,
  payload: {
    transaction: Buffer.from("stellar-transaction-xdr").toString("base64")
  }
};

export const testPaymentRequest = {
  x402Version: 2 as const,
  paymentPayload: testPaymentPayload,
  paymentRequirements: testPaymentRequirement
};

export const testPaymentConfigEnv = {
  STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId
};

export function createTestPaymentRequest(seed = "default") {
  const paymentRequirements = {
    ...testPaymentRequirement,
    extra: { ...testPaymentRequirement.extra }
  };
  const paymentPayload = {
    x402Version: 2 as const,
    accepted: paymentRequirements,
    payload: {
      transaction: Buffer.from(`stellar-transaction-xdr:${seed}`).toString("base64")
    }
  };

  return {
    x402Version: 2 as const,
    paymentPayload,
    paymentRequirements
  };
}

export const testMalformedPaymentRequest = {
  ...createTestPaymentRequest("malformed"),
  paymentPayload: {
    ...testPaymentPayload,
    payload: { transaction: "not base64!" }
  }
};

export const testWrongVersionPaymentRequest = {
  ...createTestPaymentRequest("wrong-version"),
  x402Version: 1
};

export const testWrongNetworkPaymentRequest = createRequestWithRequirement("wrong-network", {
  network: "stellar:futurenet"
});

export const testWrongSchemePaymentRequest = createRequestWithRequirement("wrong-scheme", {
  scheme: "upto"
});

export const testWrongAssetPaymentRequest = createRequestWithRequirement("wrong-asset", {
  asset: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
});

export const testExpiredPaymentRequest = createTestPaymentRequest("expired-ledger-bounds");

function createRequestWithRequirement(seed: string, override: Record<string, unknown>) {
  const paymentRequirements = { ...testPaymentRequirement, ...override };
  return {
    x402Version: 2,
    paymentRequirements,
    paymentPayload: {
      x402Version: 2,
      accepted: paymentRequirements,
      payload: {
        transaction: Buffer.from(`stellar-transaction-xdr:${seed}`).toString("base64")
      }
    }
  };
}

/**
 * Test resource metadata fixture
 */
export const testResourceMetadata = {
  metadataVersion: 1,
  resource: {
    type: testResource.type,
    name: testResource.name,
    description: testResource.description,
    url: testResource.url,
    routeTemplate: testResource.routeTemplate,
    inputSchema: testResource.inputSchema,
    outputSchema: testResource.outputSchema,
    extensions: testResource.extensions
  }
};
