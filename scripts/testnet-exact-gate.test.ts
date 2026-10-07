import { describe, expect, it, vi } from "vitest";

import { encodePaymentRequiredV2 } from "../packages/stellar-payments/src/index.js";
import { testPaymentPayload, testPaymentRequirement } from "../packages/testkit/src/index.js";

import { runExactTestnetGate } from "./testnet-exact-gate.js";
import { type TestnetEndpointManifest, type TestnetProbeEvidence } from "./testnet-probe.js";

const sha = "a".repeat(40);
const manifest = {
  environment: "testnet",
  status: "deployed",
  commits: { api: sha, worker: sha, mcp: sha, paidResource: sha },
  migrationRunId: "migration-run-123",
  api: {
    baseUrl: "https://api.test",
    health: "https://api.test/health",
    readiness: "https://api.test/ready",
    metrics: "https://api.test/metrics",
    supported: "https://api.test/v1/supported",
    version: "https://api.test/version"
  },
  mcp: {
    health: "https://mcp.test/health",
    readiness: "https://mcp.test/ready",
    version: "https://mcp.test/version",
    metrics: "https://mcp.test/metrics",
    schema: "https://mcp.test/schema"
  },
  paidResource: {
    baseUrl: "https://weather.test",
    health: "https://weather.test/health",
    readiness: "https://weather.test/ready",
    version: "https://weather.test/version",
    metrics: "https://weather.test/metrics",
    resourceUrl: "https://weather.test/weather/Lagos",
    resourceId: "resource_weather"
  }
} satisfies TestnetEndpointManifest;

const deployment: TestnetProbeEvidence = {
  checkedAt: "2026-10-07T00:00:00.000Z",
  commits: manifest.commits,
  migrationRunId: manifest.migrationRunId,
  officialV2Challenge: true,
  supportedExactTestnet: true
};

describe("testnet exact flow gate", () => {
  it("proves the same settlement and receipt survive the operator restart gate", async () => {
    const receipt = {
      id: "receipt_live",
      transactionHash: "tx_live",
      ledger: 123456,
      status: "finalized",
      settledAt: "2026-10-07T00:00:00.000Z"
    };
    const settlement = {
      success: true as const,
      amount: testPaymentRequirement.amount,
      network: "stellar:testnet" as const,
      transaction: "tx_live",
      extra: {
        lumenbazaar: {
          correlationId: "corr_live",
          settlementId: "settlement_live",
          receiptId: receipt.id,
          transactionHash: "tx_live",
          ledger: receipt.ledger,
          status: "confirmed" as const
        }
      }
    };
    const restartGate = vi.fn(async () => undefined);
    const settle = vi.fn(async () => settlement);
    const fetchImpl = vi.fn(
      async () =>
        new Response("payment required", {
          status: 402,
          headers: {
            "payment-required": encodePaymentRequiredV2({
              x402Version: 2,
              resource: { url: manifest.paidResource.resourceUrl },
              accepts: [testPaymentRequirement]
            })
          }
        })
    );

    const evidence = await runExactTestnetGate(manifest, deployment, {
      fetchImpl,
      restartGate,
      sign: async (requirements, resource) => ({
        ...testPaymentPayload,
        accepted: requirements,
        resource
      }),
      runFlow: async () => ({
        call: { success: true, statusCode: 200, data: { paid: true } },
        paymentPayload: testPaymentPayload,
        receipt,
        resource: {
          id: manifest.paidResource.resourceId,
          name: "Paid Weather API",
          description: "Weather",
          type: "http",
          url: manifest.paidResource.resourceUrl,
          inputSchema: {},
          outputSchema: {},
          paymentTerms: testPaymentRequirement
        },
        settlement,
        verification: {
          isValid: true,
          extra: {
            lumenbazaar: {
              correlationId: "corr_live",
              paymentAttemptId: "attempt_live",
              paymentHash: "hash_live",
              network: "stellar:testnet",
              status: "verified",
              adapter: "@x402/stellar"
            }
          }
        }
      }),
      settle,
      receipt: async () => receipt
    });

    expect(restartGate).toHaveBeenCalledOnce();
    expect(settle).toHaveBeenCalledOnce();
    expect(evidence).toMatchObject({
      restartConfirmedByOperator: true,
      receipt: { id: "receipt_live", transactionHash: "tx_live" },
      settlement: { correlationId: "corr_live", receiptId: "receipt_live" }
    });
    expect(JSON.stringify(evidence)).not.toContain(testPaymentPayload.payload.transaction);
  });
});
