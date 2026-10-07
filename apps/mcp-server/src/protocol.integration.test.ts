import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testPaymentPayload } from "@lumenbazaar/testkit";

import { BackendClient } from "./client.js";
import { startMcpHttpServer } from "./http.js";

describe("public MCP Streamable HTTP protocol", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes from a clean SDK client, lists usable tools, and searches", async () => {
    const backend = new BackendClient("https://api.example.test");
    vi.spyOn(backend, "searchResources").mockResolvedValue({
      resources: [
        {
          id: "resource_weather",
          name: "Paid Weather API",
          description: "Testnet weather",
          type: "http",
          url: "https://weather.example.test/weather/Lagos",
          paymentTerms: {
            scheme: "exact",
            network: "stellar:testnet",
            asset: "CB256KDRXDO2FYJN3YBYZE5KCU46WIIE67DRP5T7HI45DRH2GM6YOJFS",
            amount: "200000",
            payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE",
            maxTimeoutSeconds: 60,
            extra: { assetCode: "USDC" }
          }
        }
      ]
    });
    const server = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      client: backend,
      capabilityProvider: async () => ({ backend: true, exact: false })
    });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    const client = new Client({ name: "phase-22-external-client", version: "1.0.0" });

    try {
      await client.connect(transport as unknown as Transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "list_supported_networks",
          "search_paid_resources",
          "inspect_resource",
          "get_payment_receipt",
          "inspect_budget"
        ])
      );
      expect(listed.tools.map((tool) => tool.name)).not.toContain("call_paid_resource");
      expect(listed.tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);

      const result = await client.callTool({
        name: "search_paid_resources",
        arguments: { query: "weather", limit: 3 }
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain("resource_weather");
      expect(backend.searchResources).toHaveBeenCalledWith({ q: "weather", limit: 3 });

      const malformed = await client.callTool({
        name: "search_paid_resources",
        arguments: { unexpected: true }
      });
      expect(malformed.isError).toBe(true);
      expect(JSON.stringify(malformed.content)).toContain("INVALID_ARGUMENT");

      const unavailable = await client.callTool({
        name: "call_paid_resource",
        arguments: {}
      });
      expect(unavailable.isError).toBe(true);
      expect(JSON.stringify(unavailable.content)).toContain("CAPABILITY_UNAVAILABLE");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a stable redacted error when a paid call dependency fails", async () => {
    const backend = new BackendClient("https://api.example.test");
    vi.spyOn(backend, "getResource").mockResolvedValue({
      id: "resource_weather",
      name: "Paid Weather API",
      description: "Testnet weather",
      type: "http",
      url: "https://weather.example.test/weather/Lagos",
      paymentTerms: testPaymentPayload.accepted
    });
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).startsWith("http://127.0.0.1:")) {
          return nativeFetch(input, init);
        }
        throw new Error("FACILITATOR_SIGNING_KEY=must-not-leak");
      })
    );
    const server = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      client: backend,
      capabilityProvider: async () => ({ backend: true, exact: true })
    });
    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    const client = new Client({ name: "phase-22-failure-client", version: "1.0.0" });

    try {
      await client.connect(transport as unknown as Transport);
      const result = await client.callTool({
        name: "call_paid_resource",
        arguments: {
          resourceId: "resource_weather",
          paymentPayload: testPaymentPayload,
          maxRetries: 0
        }
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("Tool execution failed");
      expect(JSON.stringify(result.content)).not.toContain("FACILITATOR_SIGNING_KEY");
      expect(JSON.stringify(result.content)).not.toContain("must-not-leak");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
