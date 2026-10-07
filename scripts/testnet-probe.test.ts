import { describe, expect, it, vi } from "vitest";

import { encodePaymentRequiredV2 } from "../packages/stellar-payments/src/index.js";
import { testPaymentRequirement } from "../packages/testkit/src/index.js";

import {
  probeTestnetDeployment,
  type TestnetEndpointManifest,
  validateTestnetEndpointManifest
} from "./testnet-probe.js";

const sha = "a".repeat(40);
const manifest: TestnetEndpointManifest = {
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
};

describe("testnet external probe", () => {
  it("rejects templates and non-pinned deployment evidence", () => {
    expect(
      validateTestnetEndpointManifest({
        ...manifest,
        status: "template",
        commits: { ...manifest.commits, api: "short" }
      })
    ).toEqual(
      expect.arrayContaining([
        "Manifest status must be deployed.",
        "api commit must be a full Git SHA."
      ])
    );
  });

  it("checks pinned API, MCP, metrics, capability, and official challenge surfaces", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/metrics")) {
        return new Response(
          url.includes("mcp.test")
            ? "# HELP lumenbazaar_mcp_http_requests_total requests"
            : url.includes("weather.test")
              ? "# HELP lumenbazaar_weather_requests_total requests"
              : "# HELP lumenbazaar_api_uptime_seconds uptime"
        );
      }
      if (url.endsWith("/version")) return Response.json({ commit: sha });
      if (url.endsWith("/health")) {
        return Response.json({
          ok: true,
          app: url.includes("mcp.test")
            ? "mcp-server"
            : url.includes("weather.test")
              ? "paid-weather-api"
              : "api"
        });
      }
      if (url.endsWith("/ready")) return Response.json({ ok: true });
      if (url.endsWith("/v1/supported")) {
        return Response.json({ kinds: [{ scheme: "exact", network: "stellar:testnet" }] });
      }
      if (url.endsWith("/schema")) {
        return Response.json({ tools: [{ name: "call_paid_resource" }] });
      }
      if (url.includes("/weather/Lagos")) {
        return new Response("payment required", {
          status: 402,
          headers: {
            "payment-required": encodePaymentRequiredV2({
              x402Version: 2,
              resource: { url },
              accepts: [testPaymentRequirement]
            })
          }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(probeTestnetDeployment(manifest, fetchImpl)).resolves.toMatchObject({
      commits: manifest.commits,
      officialV2Challenge: true,
      supportedExactTestnet: true
    });
  });
});
