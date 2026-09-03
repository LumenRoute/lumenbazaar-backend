import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LumenError, loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";
import {
  InMemoryPaymentAttemptStore,
  PaymentVerificationService,
  SettlementService,
  type X402StellarAdapter
} from "@lumenbazaar/stellar-payments";

import { buildApiApp } from "./app.js";
import { parseBody } from "./http/validation.js";

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
    const settlementService = new SettlementService(config, { adapter, attemptStore });
    const app = buildApiApp({
      logger: false,
      verificationService,
      settlementService
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
      ledger: 456,
      status: "settled"
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
