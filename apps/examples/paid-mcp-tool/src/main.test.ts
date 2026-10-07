import { afterEach, describe, expect, it, vi } from "vitest";

import { testPaymentPayload } from "@lumenbazaar/testkit";

import {
  callPaidMcpToolThroughLumenBazaar,
  createPaidMcpToolApp,
  createPaidMcpToolCatalogMetadata,
  paidMcpPaymentRequirement,
  paidMcpToolName,
  paidMcpToolRequestSchema,
  registerPaidMcpToolInDiscovery,
  runPaidMcpTool
} from "./main.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("paid MCP tool example", () => {
  it("serves MCP metadata and gates the tool behind exact x402 terms", async () => {
    const app = createPaidMcpToolApp({
      baseUrl: "https://mcp.example.test",
      sellerId: "seller_mcp"
    });

    const metadata = await app.inject({
      method: "GET",
      url: "/.well-known/lumenbazaar.json"
    });
    const unpaid = await app.inject({
      method: "POST",
      url: `/tools/${paidMcpToolName}`,
      payload: {
        sku: "LBZ-PRO",
        quantity: 2
      }
    });
    const paid = await app.inject({
      method: "POST",
      url: `/tools/${paidMcpToolName}`,
      headers: {
        "payment-signature": Buffer.from(JSON.stringify(testPaymentPayload)).toString("base64")
      },
      payload: {
        sku: "LBZ-PRO",
        quantity: 2
      }
    });

    expect(metadata.json()).toMatchObject({
      sellerId: "seller_mcp",
      resource: {
        type: "mcp",
        routeTemplate: "mcp://lumenbazaar-examples/quote_price",
        extensions: {
          bazaar: true,
          mcp: {
            toolName: "quote_price"
          }
        }
      }
    });
    expect(unpaid.statusCode).toBe(402);
    expect(unpaid.json()).toMatchObject({
      x402Version: 2,
      accepts: [paidMcpPaymentRequirement]
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({
      currency: "USD",
      paid: true,
      quantity: 2,
      sku: "LBZ-PRO"
    });

    await app.close();
  });

  it("registers paid MCP metadata in discovery", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        sellerId: "seller_mcp",
        resource: {
          type: "mcp",
          network: "stellar:testnet",
          assetCode: "USDC",
          amount: "0.03",
          routeTemplate: "mcp://lumenbazaar-examples/quote_price",
          extensions: {
            bazaar: true,
            mcp: {
              serverName: "lumenbazaar-examples",
              toolName: "quote_price",
              transport: "http-bridge"
            }
          }
        }
      });

      return Response.json({
        ok: true,
        resourceId: "resource_mcp_tool",
        versionId: "resource_version_mcp_tool",
        catalogEventId: "catalog_event_mcp_tool",
        indexingStatus: "queued"
      });
    });

    await expect(
      registerPaidMcpToolInDiscovery({
        apiUrl: "https://api.example.test",
        baseUrl: "https://mcp.example.test",
        fetchImpl,
        sellerId: "seller_mcp"
      })
    ).resolves.toMatchObject({
      ok: true,
      resourceId: "resource_mcp_tool"
    });
  });

  it("can be called through LumenBazaar MCP payment tools with tool arguments", async () => {
    const resource = createPaidMcpToolCatalogMetadata({
      baseUrl: "https://mcp.example.test",
      sellerId: "seller_mcp"
    }).resource;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url === "https://api.example.test/v1/resources/resource_mcp_tool") {
        return Response.json({
          id: "resource_mcp_tool",
          ...resource
        });
      }

      if (url === "https://api.example.test/v1/verify") {
        return Response.json({
          isValid: true,
          extra: {
            lumenbazaar: {
              paymentAttemptId: "attempt_mcp_tool",
              paymentHash: "hash_mcp_tool",
              network: "stellar:testnet",
              status: "verified",
              adapter: "@x402/stellar"
            }
          }
        });
      }

      if (url === "https://mcp.example.test/tools/quote_price") {
        expect(JSON.parse(String(init?.body))).toEqual({
          sku: "LBZ-PRO",
          quantity: 3
        });

        return Response.json(runPaidMcpTool({ sku: "LBZ-PRO", quantity: 3 }));
      }

      if (url === "https://api.example.test/v1/settle") {
        return Response.json({
          success: true,
          amount: "300000",
          network: "stellar:testnet",
          transaction: "tx_mcp_tool",
          extra: {
            lumenbazaar: {
              receiptId: "receipt_mcp_tool",
              settlementId: "settlement_mcp_tool",
              transactionHash: "tx_mcp_tool",
              ledger: 56789,
              status: "settled"
            }
          }
        });
      }

      if (url === "https://api.example.test/v1/receipts/receipt_mcp_tool") {
        return Response.json({
          id: "receipt_mcp_tool",
          transactionHash: "tx_mcp_tool",
          ledger: 56789,
          status: "finalized",
          settledAt: "2026-09-05T00:00:00.000Z"
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    await expect(
      callPaidMcpToolThroughLumenBazaar({
        apiUrl: "https://api.example.test",
        input: paidMcpToolRequestSchema.parse({
          sku: "LBZ-PRO",
          quantity: 3
        }),
        paymentPayload: {
          ...testPaymentPayload,
          accepted: paidMcpPaymentRequirement
        },
        resourceId: "resource_mcp_tool",
        serverBaseUrl: "https://mcp.example.test"
      })
    ).resolves.toMatchObject({
      call: {
        data: {
          currency: "USD",
          paid: true,
          quantity: 3,
          sku: "LBZ-PRO"
        },
        success: true
      },
      receipt: {
        id: "receipt_mcp_tool",
        status: "finalized"
      },
      verification: {
        isValid: true,
        extra: {
          lumenbazaar: {
            paymentAttemptId: "attempt_mcp_tool"
          }
        }
      }
    });
  });
});
