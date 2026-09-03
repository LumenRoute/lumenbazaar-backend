import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { DiscoveryService } from "./discovery.js";
import { ResourceService } from "./resources.js";
import { SellerService } from "./sellers.js";

describe("DiscoveryService", () => {
  it("browses resources with deterministic filters and pagination metadata", async () => {
    const sellerService = new SellerService();
    const resourceService = new ResourceService(loadConfig({}), sellerService);
    const discoveryService = new DiscoveryService(resourceService);
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    await resourceService.createResource({
      sellerId: seller.id,
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
    });

    await expect(
      discoveryService.browse({
        network: "stellar:testnet",
        asset: "USDC",
        type: "http",
        sellerId: seller.id,
        minPrice: "0.01",
        maxPrice: "0.10",
        extension: "bazaar"
      })
    ).resolves.toMatchObject({
      resources: [
        {
          name: "Paid Weather API"
        }
      ],
      nextCursor: null,
      partialResults: false
    });
  });
});
