import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { CatalogService, InMemoryResourceIndexingQueue } from "./cataloging.js";
import { CatalogValidationService } from "./catalogValidation.js";
import { ResourceService } from "./resources.js";
import { SellerService } from "./sellers.js";

function metadata(sellerId: string) {
  return {
    sellerId,
    resource: {
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
    }
  };
}

describe("CatalogService", () => {
  it("catalogs valid resources and queues indexing jobs", async () => {
    const sellerService = new SellerService();
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const config = loadConfig({});
    const resourceService = new ResourceService(config, sellerService);
    const validationService = new CatalogValidationService(config, sellerService);
    const indexingQueue = new InMemoryResourceIndexingQueue();
    const catalogService = new CatalogService(validationService, resourceService, {
      indexingQueue
    });

    const result = await catalogService.catalog(metadata(seller.id));

    expect(result).toMatchObject({
      ok: true,
      indexingStatus: "queued"
    });
    expect(indexingQueue.jobs).toEqual([
      {
        name: "resource.index",
        resourceId: result.resourceId,
        versionId: result.versionId
      }
    ]);
  });

  it("rejects invalid resources with stable reasons", async () => {
    const sellerService = new SellerService();
    const config = loadConfig({});
    const resourceService = new ResourceService(config, sellerService);
    const validationService = new CatalogValidationService(config, sellerService);
    const catalogService = new CatalogService(validationService, resourceService);

    await expect(catalogService.catalog(metadata("missing_seller"))).rejects.toMatchObject({
      code: "CATALOG_VALIDATION_FAILED"
    });
  });
});
