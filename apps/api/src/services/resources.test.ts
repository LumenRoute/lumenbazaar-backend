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
});
