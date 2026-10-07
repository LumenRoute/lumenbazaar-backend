import { describe, expect, it, vi } from "vitest";

import { testPaymentPayload } from "@lumenbazaar/testkit";

import {
  createRagApp,
  createRagCatalogMetadata,
  createRagPaymentRequirement,
  verifyRagReceipt
} from "./main.js";

describe("paid RAG API example", () => {
  it("prices each request and returns x402 terms before serving answers", async () => {
    const app = createRagApp({
      baseUrl: "https://rag.example.test",
      sellerId: "seller_rag"
    });

    const unpaid = await app.inject({
      method: "POST",
      url: "/rag/query",
      payload: {
        question: "How does paid discovery work?",
        topK: 4
      }
    });
    const paid = await app.inject({
      method: "POST",
      url: "/rag/query",
      headers: {
        "payment-signature": Buffer.from(JSON.stringify(testPaymentPayload)).toString("base64")
      },
      payload: {
        corpus: "api",
        question: "How does paid discovery work?",
        topK: 2
      }
    });

    expect(unpaid.statusCode).toBe(402);
    expect(unpaid.json()).toMatchObject({
      x402Version: 2,
      accepts: [
        {
          amount: "900000",
          scheme: "exact",
          network: "stellar:testnet"
        }
      ]
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({
      paid: true,
      pricing: {
        amount: "0.07",
        model: "per-request",
        network: "stellar:testnet"
      }
    });
    expect(paid.json().citations).toHaveLength(2);

    await app.close();
  });

  it("publishes metadata with RAG schemas and pricing extensions", () => {
    expect(
      createRagCatalogMetadata({
        baseUrl: "https://rag.example.test",
        sellerId: "seller_rag"
      })
    ).toMatchObject({
      sellerId: "seller_rag",
      resource: {
        type: "http",
        url: "https://rag.example.test/rag/query",
        routeTemplate: "/rag/query",
        amount: "0.08",
        inputSchema: {
          properties: {
            question: {
              type: "string"
            }
          }
        },
        outputSchema: {
          properties: {
            citations: {
              type: "array"
            }
          }
        },
        extensions: {
          bazaar: true,
          example: "paid-rag-api",
          pricing: {
            baseAmount: "0.05",
            defaultAmount: "0.08",
            model: "per-request",
            topKIncrement: "0.01"
          }
        }
      }
    });
  });

  it("builds exact payment requirements from request shape", () => {
    expect(
      createRagPaymentRequirement({
        question: "What changed?",
        topK: 8
      })
    ).toMatchObject({
      amount: "1300000",
      asset: "CB256KDRXDO2FYJN3YBYZE5KCU46WIIE67DRP5T7HI45DRH2GM6YOJFS",
      scheme: "exact"
    });
  });

  it("verifies finalized receipts against expected resource and amount", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        id: "receipt_rag",
        resourceId: "resource_rag",
        transactionHash: "tx_rag",
        ledger: 45678,
        status: "finalized",
        amount: "0.08"
      })
    );

    await expect(
      verifyRagReceipt({
        apiUrl: "https://api.example.test",
        expectedAmount: "0.08",
        expectedResourceId: "resource_rag",
        fetchImpl,
        receiptId: "receipt_rag"
      })
    ).resolves.toEqual({
      ok: true,
      receiptId: "receipt_rag",
      status: "finalized",
      transactionHash: "tx_rag",
      ledger: 45678,
      resourceId: "resource_rag",
      amount: "0.08"
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example.test/v1/receipts/receipt_rag", {
      method: "GET"
    });
  });
});
