import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { ResourceService } from "./resources.js";
import { SearchService } from "./search.js";
import { SellerService } from "./sellers.js";

describe("SearchService", () => {
  it("indexes and ranks resources by natural language-like query terms", async () => {
    const sellerService = new SellerService();
    const resourceService = new ResourceService(loadConfig({}), sellerService);
    const searchService = new SearchService(resourceService);
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    await resourceService.createResource({
      sellerId: seller.id,
      type: "http",
      name: "Paid Weather API",
      description: "Returns current weather and forecast data for a city.",
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
        type: "object",
        properties: {
          temperature: {
            type: "number"
          }
        }
      },
      extensions: {
        bazaar: true
      }
    });

    await searchService.rebuildIndex();

    await expect(searchService.search({ q: "weather forecast", limit: 5 })).resolves.toMatchObject({
      resources: [
        {
          name: "Paid Weather API",
          ranking: {
            matchedTerms: ["weather", "forecast"]
          }
        }
      ],
      ranking: {
        strategy: "postgres-full-text-v1"
      },
      partialResults: false,
      nextCursor: null
    });
  });
});
