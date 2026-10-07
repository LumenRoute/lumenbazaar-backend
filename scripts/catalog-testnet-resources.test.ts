import { describe, expect, it, vi } from "vitest";

import { catalogTestnetResources } from "./catalog-testnet-resources.js";

describe("catalogTestnetResources", () => {
  it("validates, catalogs, inspects, browses, and searches all three examples", async () => {
    const resources: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/discovery/validate")) {
        return Response.json({ ok: true, warnings: [], errors: [] });
      }
      if (url.endsWith("/v1/discovery/catalog")) {
        expect(JSON.parse(String(init?.body))).toHaveProperty("resource.name");
        const resourceId = `resource_${resources.length + 1}`;
        resources.push(resourceId);
        return Response.json({
          ok: true,
          resourceId,
          versionId: `version_${resources.length}`,
          catalogEventId: `event_${resources.length}`,
          indexingStatus: "queued"
        });
      }
      const inspected = url.match(/\/v1\/resources\/(resource_\d+)$/u)?.[1];
      if (inspected !== undefined) {
        return Response.json({ id: inspected });
      }
      if (url.includes("/v1/discovery/resources?") || url.includes("/v1/discovery/search?")) {
        return Response.json({ resources: resources.map((id) => ({ id })) });
      }
      return new Response("unexpected URL", { status: 404 });
    });

    await expect(
      catalogTestnetResources(
        {
          apiUrl: "https://api.example.test",
          weatherBaseUrl: "https://weather.example.test",
          weatherSellerId: "seller_weather",
          ragBaseUrl: "https://rag.example.test",
          ragSellerId: "seller_rag",
          mcpBaseUrl: "https://mcp.example.test",
          mcpSellerId: "seller_mcp"
        },
        fetchImpl
      )
    ).resolves.toMatchObject({
      published: [
        { key: "weather", resourceId: "resource_1" },
        { key: "rag", resourceId: "resource_2" },
        { key: "mcp", resourceId: "resource_3" }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });

  it("rejects non-HTTPS deployment targets before making requests", async () => {
    const fetchImpl = vi.fn();
    await expect(
      catalogTestnetResources(
        {
          apiUrl: "http://localhost:8000",
          weatherBaseUrl: "https://weather.example.test",
          weatherSellerId: "seller_weather",
          ragBaseUrl: "https://rag.example.test",
          ragSellerId: "seller_rag",
          mcpBaseUrl: "https://mcp.example.test",
          mcpSellerId: "seller_mcp"
        },
        fetchImpl
      )
    ).rejects.toThrow("apiUrl must be a credential-free HTTPS base URL");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
