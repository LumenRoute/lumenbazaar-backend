import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LumenError, loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";
import {
  InMemoryPaymentAttemptStore,
  PaymentVerificationService,
  ReceiptService,
  SettlementService,
  type X402StellarAdapter
} from "@lumenbazaar/stellar-payments";

import { buildApiApp } from "./app.js";
import { parseBody } from "./http/validation.js";
import { ResourceService } from "./services/resources.js";
import { SellerService } from "./services/sellers.js";

describe("API server base", () => {
  it("adds request IDs to responses", async () => {
    const app = buildApiApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.json()).toMatchObject({
      ok: true,
      service: "lumenbazaar-backend",
      app: "api"
    });
    await app.close();
  });

  it("returns version, metrics, and supported networks", async () => {
    const app = buildApiApp({ logger: false });

    const version = await app.inject({ method: "GET", url: "/version" });
    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    const networks = await app.inject({ method: "GET", url: "/v1/networks" });

    expect(version.json()).toMatchObject({
      service: "lumenbazaar-backend",
      version: "0.1.0"
    });
    expect(metrics.body).toContain("lumenbazaar_api_uptime_seconds");
    expect(networks.json().networks.map((network: { id: string }) => network.id)).toEqual([
      "stellar:testnet",
      "stellar:pubnet"
    ]);
    await app.close();
  });

  it("returns x402 exact support with reserved extension fields", async () => {
    const app = buildApiApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/v1/supported" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemes: [
        {
          name: "exact",
          network: "stellar:testnet",
          extensions: {
            x402Version: "1",
            upto: false
          }
        },
        {
          name: "exact",
          network: "stellar:pubnet"
        }
      ],
      extensions: {
        bazaar: true,
        upto: false,
        uptoContracts: []
      }
    });
    await app.close();
  });

  it("verifies exact payment requests through the facilitator route", async () => {
    const adapter: X402StellarAdapter = {
      async verifyExact() {
        return {
          valid: true,
          adapter: "@x402/stellar"
        };
      }
    };
    const config = loadConfig({});
    const app = buildApiApp({
      logger: false,
      verificationService: new PaymentVerificationService(config, { adapter })
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/verify",
      payload: exactPaymentRequest()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      network: "stellar:testnet",
      status: "verified",
      adapter: "@x402/stellar"
    });
    expect(response.json().paymentHash).toHaveLength(64);
    await app.close();
  });

  it("settles verified exact payment requests through the facilitator route", async () => {
    const adapter: X402StellarAdapter = {
      async verifyExact() {
        return {
          valid: true,
          adapter: "@x402/stellar"
        };
      },
      async settleExact() {
        return {
          transactionHash: "tx_api_settle",
          ledger: 456,
          adapter: "@x402/stellar"
        };
      }
    };
    const config = loadConfig({});
    const attemptStore = new InMemoryPaymentAttemptStore();
    const verificationService = new PaymentVerificationService(config, { adapter, attemptStore });
    const receiptService = new ReceiptService();
    const settlementService = new SettlementService(config, {
      adapter,
      attemptStore,
      receiptService
    });
    const app = buildApiApp({
      logger: false,
      verificationService,
      settlementService,
      receiptService
    });
    const verified = await verificationService.verify(exactPaymentRequest());

    const response = await app.inject({
      method: "POST",
      url: "/v1/settle",
      payload: {
        paymentAttemptId: verified.paymentAttemptId,
        ...exactPaymentRequest()
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      transactionHash: "tx_api_settle",
      receiptId: expect.stringMatching(/^receipt_/),
      ledger: 456,
      status: "settled"
    });

    const receipt = await app.inject({
      method: "GET",
      url: `/v1/receipts/${response.json().receiptId}`
    });

    expect(receipt.statusCode).toBe(200);
    expect(receipt.json()).toMatchObject({
      paymentAttemptId: verified.paymentAttemptId,
      transactionHash: "tx_api_settle",
      status: "finalized"
    });
    await app.close();
  });

  it("creates and fetches sellers through API routes", async () => {
    const sellerService = new SellerService();
    const app = buildApiApp({ logger: false, sellerService });

    const created = await app.inject({
      method: "POST",
      url: "/v1/sellers",
      payload: {
        displayName: "Weather Seller",
        walletAddress: localIssuerPublicKey,
        domain: "seller.example"
      }
    });

    expect(created.statusCode).toBe(200);

    const fetched = await app.inject({
      method: "GET",
      url: `/v1/sellers/${created.json().id}`
    });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    const challenge = await app.inject({
      method: "POST",
      url: `/v1/sellers/${created.json().id}/verify-domain`,
      payload: {
        method: "dns"
      }
    });
    const verified = await app.inject({
      method: "POST",
      url: `/v1/sellers/${created.json().id}/verify-domain`,
      payload: {
        evidence: challenge.json().challenge
      }
    });

    expect(challenge.json()).toMatchObject({
      method: "dns",
      verified: false
    });
    expect(verified.json()).toMatchObject({
      verified: true,
      domainVerifiedAt: expect.any(String)
    });
    await app.close();
  });

  it("manages resources through API routes with seller ownership", async () => {
    const sellerService = new SellerService();
    const resourceService = new ResourceService(loadConfig({}), sellerService);
    const app = buildApiApp({ logger: false, sellerService, resourceService });
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/resources",
      payload: resourcePayload(seller.id)
    });

    expect(created.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/resources?sellerId=${seller.id}`
    });
    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/resources/${created.json().id}`,
      payload: {
        name: "Paid Forecast API"
      }
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/resources/${created.json().id}`
    });

    expect(listed.json().resources).toHaveLength(1);
    expect(updated.json().name).toBe("Paid Forecast API");
    expect(deleted.json().status).toBe("inactive");
    await app.close();
  });

  it("validates discovery metadata without cataloging it", async () => {
    const sellerService = new SellerService();
    const app = buildApiApp({ logger: false, sellerService });
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/discovery/validate",
      payload: {
        sellerId: seller.id,
        resource: resourcePayload(seller.id)
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      warnings: [],
      errors: []
    });
    await app.close();
  });

  it("catalogs valid discovery metadata through the API route", async () => {
    const sellerService = new SellerService();
    const app = buildApiApp({ logger: false, sellerService });
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/discovery/catalog",
      payload: {
        sellerId: seller.id,
        resource: resourcePayload(seller.id)
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      resourceId: expect.stringMatching(/^resource_/),
      versionId: expect.stringMatching(/^resource_version_/),
      catalogEventId: expect.stringMatching(/^catalog_event_/),
      indexingStatus: "queued"
    });
    await app.close();
  });

  it("returns stable envelopes for application errors", async () => {
    const app = buildApiApp({ logger: false });
    app.get("/boom", async () => {
      throw new LumenError("UNSUPPORTED_NETWORK", "Network not supported.");
    });

    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_NETWORK",
        message: "Network not supported."
      }
    });
    await app.close();
  });

  it("maps JSON schema validation failures to stable errors", async () => {
    const app = buildApiApp({ logger: false });
    app.post(
      "/schema-check",
      {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" }
            }
          }
        }
      },
      async () => ({ ok: true })
    );

    const response = await app.inject({
      method: "POST",
      url: "/schema-check",
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("maps Zod parsing failures to stable errors", async () => {
    const app = buildApiApp({ logger: false });
    app.post("/zod-check", async (request) => {
      parseBody(request, z.object({ amount: z.string().regex(/^\d+$/) }));
      return { ok: true };
    });

    const response = await app.inject({
      method: "POST",
      url: "/zod-check",
      payload: { amount: "bad" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    await app.close();
  });
});

function exactPaymentRequest() {
  return {
    paymentPayload: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo: localIssuerPublicKey,
      expiresAtLedger: 10,
      authorization: {
        signature: "sig"
      }
    },
    paymentRequirements: {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "0.05",
      payTo: localIssuerPublicKey
    },
    currentLedger: 9
  };
}

function resourcePayload(sellerId: string) {
  return {
    sellerId,
    type: "http",
    name: "Paid Weather API",
    description: "Returns current weather for a city.",
    url: "https://seller.example/weather/Lagos",
    routeTemplate: "/weather/{city}",
    network: "stellar:testnet",
    payTo: localIssuerPublicKey,
    assetCode: "USDC",
    assetIssuer: localIssuerPublicKey,
    amount: "0.05",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string"
        }
      }
    },
    outputSchema: {
      type: "object"
    },
    extensions: {
      bazaar: true
    }
  };
}
