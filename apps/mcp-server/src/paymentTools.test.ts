import { afterEach, describe, expect, it, vi } from "vitest";

import { createBudgetManager } from "@lumenbazaar/buyer-sdk";
import { testAssetContractId, testPaymentPayload } from "@lumenbazaar/testkit";

import { McpPaymentToolService } from "./paymentTools.js";
import { listToolDefinitions } from "./tools.js";

describe("MCP payment tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers payment tools for agents", () => {
    expect(listToolDefinitions().map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "prepare_payment",
        "call_paid_resource",
        "get_payment_receipt",
        "inspect_budget"
      ])
    );
  });

  it("prepares payment payloads from resource terms and exposes budget state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(resource()))
    );
    const service = new McpPaymentToolService({ apiUrl: "https://api.example.test" });

    await expect(
      service.preparePayment({
        resourceId: "resource_1"
      })
    ).resolves.toMatchObject({
      resourceId: "resource_1",
      paymentRequirements: {
        amount: "500000",
        asset: testAssetContractId,
        scheme: "exact",
        maxTimeoutSeconds: 60
      },
      requiresWalletSignature: true,
      budget: {
        state: {
          callCount: 0
        }
      }
    });
  });

  it("rejects payment preparation when local budget caps would be exceeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(resource()))
    );
    const service = new McpPaymentToolService({
      apiUrl: "https://api.example.test",
      budgetManager: createBudgetManager({
        assetCode: "USDC",
        maxAmountPerCall: "0.01",
        maxTotalSpent: "1",
        network: "stellar:testnet"
      })
    });

    await expect(service.preparePayment({ resourceId: "resource_1" })).rejects.toThrow(
      "Local budget cap exceeded"
    );
  });

  it("calls paid resources through verify, resource call, settle, and receipt lookup", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.example.test/v1/resources/resource_1") {
        return Response.json(resource());
      }

      if (url === "https://api.example.test/v1/verify" && init?.method === "POST") {
        return Response.json({
          isValid: true,
          extra: {
            lumenbazaar: {
              adapter: "@x402/stellar",
              network: "stellar:testnet",
              paymentAttemptId: "attempt_1",
              paymentHash: "hash_1",
              status: "verified"
            }
          }
        });
      }

      if (url === "https://seller.example/weather" && init?.method === "POST") {
        return Response.json({
          forecast: "clear"
        });
      }

      if (url === "https://api.example.test/v1/settle" && init?.method === "POST") {
        return Response.json({
          success: true,
          network: "stellar:testnet",
          amount: "500000",
          transaction: "tx_1",
          extra: {
            lumenbazaar: {
              ledger: 55,
              receiptId: "receipt_1",
              settlementId: "settlement_1",
              status: "settled",
              transactionHash: "tx_1"
            }
          }
        });
      }

      if (url === "https://api.example.test/v1/receipts/receipt_1") {
        return Response.json({
          id: "receipt_1",
          ledger: 55,
          settledAt: "2026-09-05T00:00:00.000Z",
          status: "finalized",
          transactionHash: "tx_1"
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const service = new McpPaymentToolService({ apiUrl: "https://api.example.test" });

    await expect(
      service.callPaidResource({
        paymentPayload: testPaymentPayload,
        resourceId: "resource_1",
        resourceUrl: "https://seller.example/weather",
        retryDelayMs: 0
      })
    ).resolves.toMatchObject({
      call: {
        data: {
          forecast: "clear"
        },
        success: true
      },
      receipt: {
        id: "receipt_1",
        status: "finalized"
      },
      settlement: {
        success: true,
        extra: {
          lumenbazaar: {
            receiptId: "receipt_1",
            status: "settled"
          }
        }
      },
      budget: {
        state: {
          callCount: 1
        }
      }
    });
  });

  it("fetches receipts by ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "receipt_1",
          status: "finalized"
        })
      )
    );
    const service = new McpPaymentToolService({ apiUrl: "https://api.example.test" });

    await expect(service.getPaymentReceipt({ receiptId: "receipt_1" })).resolves.toEqual({
      id: "receipt_1",
      status: "finalized"
    });
  });
});

function resource() {
  return {
    id: "resource_1",
    name: "Weather API",
    description: "Weather data",
    type: "http",
    url: "https://seller.example/weather",
    routeTemplate: "/weather/{city}",
    inputSchema: {
      type: "object"
    },
    outputSchema: {
      type: "object"
    },
    network: "stellar:testnet",
    assetCode: "USDC",
    assetIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    amount: "0.05",
    payTo: testPaymentPayload.accepted.payTo,
    extensions: {
      assetContractId: testAssetContractId
    }
  };
}
