import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { ResourceService } from "./resources.js";
import { SellerService } from "./sellers.js";

function resourceInput(sellerId: string) {
  return {
    sellerId,
    type: "http",
    name: "Paid Weather API",
    description: "Returns current weather for a city.",
    url: "https://seller.example/weather/Lagos",
    routeTemplate: "/weather/{city}",
    network: "stellar:testnet",
    payTo: localIssuerPublicKey,
    assetCode: "usdc",
    assetIssuer: localIssuerPublicKey,
    amount: "0.0500000",
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

describe("ResourceService", () => {
  it("creates, lists, updates, and soft-deletes resources with seller ownership", async () => {
    const sellerService = new SellerService();
    const resourceService = new ResourceService(loadConfig({}), sellerService);
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const resource = await resourceService.createResource(resourceInput(seller.id));

    expect(resource).toMatchObject({
      sellerId: seller.id,
      assetCode: "USDC",
      amount: "0.05",
      status: "active"
    });
    await expect(resourceService.getResource(resource.id)).resolves.toEqual(resource);
    await expect(resourceService.listResources({ sellerId: seller.id })).resolves.toMatchObject({
      resources: [resource],
      nextCursor: null
    });

    const updated = await resourceService.updateResource(resource.id, {
      name: "Paid Forecast API"
    });
    const deleted = await resourceService.deleteResource(resource.id);

    expect(updated.name).toBe("Paid Forecast API");
    expect(deleted.status).toBe("inactive");
  });

  it("rejects resources for missing sellers and unsupported assets", async () => {
    const sellerService = new SellerService();
    const resourceService = new ResourceService(loadConfig({}), sellerService);

    await expect(resourceService.createResource(resourceInput("missing"))).rejects.toMatchObject({
      code: "SELLER_NOT_FOUND"
    });

    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    await expect(
      resourceService.createResource({
        ...resourceInput(seller.id),
        assetCode: "EURC"
      })
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_ASSET"
    });
  });

  it.each([
    "http://seller.example/weather/Lagos",
    "https://evil.example/weather/Lagos",
    "https://127.0.0.1/weather/Lagos",
    "https://seller.example/admin/Lagos",
    "https://seller.example/weather/Lagos?target=https://internal.example"
  ])("rejects unsafe or template-conflicting resource target %s", async (url) => {
    const sellerService = new SellerService();
    const resourceService = new ResourceService(loadConfig({}), sellerService);
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    await expect(
      resourceService.createResource({ ...resourceInput(seller.id), url })
    ).rejects.toMatchObject({
      code: expect.stringMatching(/CATALOG_VALIDATION_FAILED|ROUTE_TEMPLATE_INVALID/u)
    });
  });

  it("accepts safe MCP tool targets and rejects tool-name mismatches", async () => {
    const sellerService = new SellerService();
    const resourceService = new ResourceService(loadConfig({}), sellerService);
    const seller = await sellerService.createSeller({
      displayName: "MCP Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const input = {
      ...resourceInput(seller.id),
      type: "mcp" as const,
      url: "https://seller.example/tools/quote_price",
      routeTemplate: "mcp://catalog/quote_price",
      extensions: {
        mcp: {
          serverName: "catalog",
          toolName: "quote_price"
        }
      }
    };

    await expect(resourceService.createResource(input)).resolves.toMatchObject({
      type: "mcp",
      routeTemplate: "mcp://catalog/quote_price"
    });
    await expect(
      resourceService.createResource({ ...input, url: "https://seller.example/tools/admin" })
    ).rejects.toMatchObject({ code: "ROUTE_TEMPLATE_INVALID" });
  });
});
