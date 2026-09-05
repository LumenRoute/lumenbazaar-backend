import { afterEach, describe, expect, it, vi } from "vitest";

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
        "x-payment-required": JSON.stringify({
          scheme: "exact"
        })
      }
    });

    expect(unpaid.statusCode).toBe(402);
    expect(unpaid.headers["x-payment-scheme"]).toBe("exact");
    expect(unpaid.json()).toMatchObject({
      paymentRequired: weatherPaymentRequirement
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({
      city: "Lagos",
      paid: true
    });

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
          assetCode: paymentTerms.asset.code,
          assetIssuer: paymentTerms.asset.issuer,
          amount: paymentTerms.amount,
          inputSchema: createWeatherCatalogMetadata().resource.inputSchema,
          outputSchema: createWeatherCatalogMetadata().resource.outputSchema
        });
      }

      if (url === "https://api.example.test/v1/verify") {
        return Response.json({
          ok: true,
          paymentAttemptId: "attempt_weather",
          status: "verified"
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
          ok: true,
          receiptId: "receipt_weather",
          settlementId: "settlement_weather",
          status: "settled",
          transactionHash: "tx_weather",
          ledger: 12345,
          settledAt: "2026-09-05T00:00:00.000Z"
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
        authorization: {
          wallet: "buyer_testnet"
        },
        city: "Lagos",
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
        receiptId: "receipt_weather",
        status: "settled"
      },
      verification: {
        paymentAttemptId: "attempt_weather",
        status: "verified"
      }
    });
  });
});
