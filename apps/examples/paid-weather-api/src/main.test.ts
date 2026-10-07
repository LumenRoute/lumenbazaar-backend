import { afterEach, describe, expect, it, vi } from "vitest";

import { testPaymentPayload } from "@lumenbazaar/testkit";

import {
  callWeatherWithBuyerSdk,
  createWeatherApp,
  createWeatherCatalogMetadata,
  publishWeatherMetadata,
  weatherPaymentRequirement
} from "./main.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("paid weather API example", () => {
  it("returns seller SDK payment requirements before serving forecast data", async () => {
    const app = createWeatherApp({ baseUrl: "https://weather.example.test", sellerId: "seller_1" });

    const unpaid = await app.inject({
      method: "GET",
      url: "/weather/Lagos"
    });
    const paid = await app.inject({
      method: "POST",
      url: "/weather/Lagos",
      headers: {
        "payment-signature": Buffer.from(JSON.stringify(testPaymentPayload)).toString("base64")
      }
    });

    expect(unpaid.statusCode).toBe(402);
    expect(unpaid.headers["payment-required"]).toEqual(expect.any(String));
    expect(unpaid.json()).toMatchObject({
      x402Version: 2,
      accepts: [weatherPaymentRequirement]
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({
      city: "Lagos",
      paid: true
    });

    await app.close();
  });

  it("exposes deployment health, version, and payment metrics", async () => {
    const app = createWeatherApp();
    await app.inject({ method: "GET", url: "/weather/Lagos" });
    await app.inject({
      method: "GET",
      url: "/weather/Lagos",
      headers: { "payment-signature": "signed" }
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    const ready = await app.inject({ method: "GET", url: "/ready" });
    const version = await app.inject({ method: "GET", url: "/version" });
    const metrics = await app.inject({ method: "GET", url: "/metrics" });

    expect(health.json()).toEqual({ ok: true, app: "paid-weather-api" });
    expect(ready.json()).toEqual({ ok: true, app: "paid-weather-api" });
    expect(version.json()).toMatchObject({ app: "paid-weather-api", version: "0.1.0" });
    expect(metrics.body).toContain(
      'lumenbazaar_weather_requests_total{result="payment_required"} 1'
    );
    expect(metrics.body).toContain('lumenbazaar_weather_requests_total{result="paid"} 1');

    await app.close();
  });

  it("publishes Bazaar discovery metadata for cataloging", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        sellerId: "seller_weather",
        resource: {
          type: "http",
          routeTemplate: "/weather/{city}",
          network: "stellar:testnet",
          assetCode: "USDC",
          amount: "0.02",
          extensions: {
            bazaar: true,
            example: "paid-weather-api"
          }
        }
      });

      return Response.json({
        ok: true,
        resourceId: "resource_weather",
        versionId: "resource_version_weather",
        catalogEventId: "catalog_event_weather",
        indexingStatus: "queued"
      });
    });

    await expect(
      publishWeatherMetadata({
        apiUrl: "https://api.example.test",
        baseUrl: "https://weather.example.test",
        fetchImpl,
        sellerId: "seller_weather"
      })
    ).resolves.toMatchObject({
      ok: true,
      resourceId: "resource_weather"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/v1/discovery/catalog",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("demonstrates a full buyer SDK exact payment call against testnet metadata", async () => {
    const resourceId = "resource_weather";
    const paymentTerms = {
      ...weatherPaymentRequirement
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === "https://api.example.test/v1/resources/resource_weather") {
        return Response.json({
          id: resourceId,
          name: "Paid Weather API",
          description: "Returns deterministic weather data.",
          type: "http",
          url: "https://weather.example.test/weather/Lagos",
          routeTemplate: "/weather/{city}",
          network: paymentTerms.network,
          payTo: paymentTerms.payTo,
          assetCode: "USDC",
          assetIssuer: paymentTerms.extra.assetIssuer,
          amount: "0.02",
          extensions: {
            assetContractId: paymentTerms.asset
          },
          inputSchema: createWeatherCatalogMetadata().resource.inputSchema,
          outputSchema: createWeatherCatalogMetadata().resource.outputSchema
        });
      }

      if (url === "https://api.example.test/v1/verify") {
        return Response.json({
          isValid: true,
          extra: {
            lumenbazaar: {
              adapter: "@x402/stellar",
              network: "stellar:testnet",
              paymentAttemptId: "attempt_weather",
              paymentHash: "hash_weather",
              status: "verified"
            }
          }
        });
      }

      if (url === "https://weather.example.test/weather/Lagos") {
        return Response.json({
          city: "Lagos",
          condition: "clear",
          humidityPercent: 61,
          paid: true,
          temperatureC: 27
        });
      }

      if (url === "https://api.example.test/v1/settle") {
        return Response.json({
          success: true,
          amount: "200000",
          network: "stellar:testnet",
          transaction: "tx_weather",
          extra: {
            lumenbazaar: {
              receiptId: "receipt_weather",
              settlementId: "settlement_weather",
              status: "settled",
              transactionHash: "tx_weather",
              ledger: 12345
            }
          }
        });
      }

      if (url === "https://api.example.test/v1/receipts/receipt_weather") {
        return Response.json({
          id: "receipt_weather",
          transactionHash: "tx_weather",
          ledger: 12345,
          status: "finalized",
          settledAt: "2026-09-05T00:00:00.000Z"
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    await expect(
      callWeatherWithBuyerSdk({
        apiUrl: "https://api.example.test",
        city: "Lagos",
        paymentPayload: {
          ...testPaymentPayload,
          accepted: paymentTerms
        },
        resourceId,
        retryDelayMs: 0
      })
    ).resolves.toMatchObject({
      call: {
        data: {
          city: "Lagos",
          paid: true
        },
        success: true
      },
      receipt: {
        id: "receipt_weather",
        status: "finalized"
      },
      settlement: {
        success: true,
        extra: {
          lumenbazaar: {
            receiptId: "receipt_weather",
            status: "settled"
          }
        }
      },
      verification: {
        isValid: true,
        extra: {
          lumenbazaar: {
            paymentAttemptId: "attempt_weather",
            status: "verified"
          }
        }
      }
    });
  });
});
