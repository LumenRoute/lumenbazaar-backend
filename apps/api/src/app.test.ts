import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LumenError } from "@lumenbazaar/shared";
import { PaymentVerificationService, type X402StellarAdapter } from "@lumenbazaar/stellar-payments";

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
    const app = buildApiApp({
      logger: false,
      verificationService: new PaymentVerificationService(
        {
          nodeEnv: "test",
          lumenEnv: "local",
          api: {
            host: "127.0.0.1",
            port: 0,
            publicUrl: "http://localhost"
          },
          databaseUrl: "postgresql://postgres:postgres@localhost:5432/lumenbazaar",
          redisUrl: "redis://localhost:6379",
          facilitatorAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          features: {
            uptoScheme: false
          },
          networks: {
            "stellar:testnet": {
              id: "stellar:testnet",
              displayName: "Stellar Testnet",
              passphrase: "Test SDF Network ; September 2015",
              rpcUrl: "https://soroban-testnet.stellar.org",
              horizonUrl: "https://horizon-testnet.stellar.org",
              assets: [
                {
                  code: "USDC",
                  issuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                  decimals: 7
                }
              ]
            },
            "stellar:pubnet": {
              id: "stellar:pubnet",
              displayName: "Stellar Pubnet",
              passphrase: "Public Global Stellar Network ; September 2015",
              rpcUrl: "https://mainnet.sorobanrpc.com",
              horizonUrl: "https://horizon.stellar.org",
              assets: [
                {
                  code: "USDC",
                  issuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
                  decimals: 7
                }
              ]
            }
          }
        },
        { adapter }
      )
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/verify",
      payload: {
        paymentPayload: {
          scheme: "exact",
          network: "stellar:testnet",
          asset: {
            code: "USDC",
            issuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
          },
          amount: "0.05",
          payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          expiresAtLedger: 10,
          authorization: {
            signature: "sig"
          }
        },
        paymentRequirements: {
          scheme: "exact",
          network: "stellar:testnet",
          amount: "0.05",
          payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        },
        currentLedger: 9
      }
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
