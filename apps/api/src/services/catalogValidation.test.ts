import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { CatalogValidationService } from "./catalogValidation.js";
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

describe("CatalogValidationService", () => {
  it("validates catalog metadata without mutating resources", async () => {
    const sellerService = new SellerService();
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const service = new CatalogValidationService(loadConfig({}), sellerService);

    await expect(service.validate(metadata(seller.id))).resolves.toEqual({
      ok: true,
      warnings: [],
      errors: []
    });
  });

  it("returns stable reasons for unsafe metadata", async () => {
    const sellerService = new SellerService();
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const service = new CatalogValidationService(loadConfig({}), sellerService);

    const result = await service.validate({
      ...metadata(seller.id),
      resource: {
        ...metadata(seller.id).resource,
        url: "https://attacker.example/weather/Lagos",
        routeTemplate: "/../secret",
        extensions: {
          trusted: true
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "CATALOG_VALIDATION_FAILED",
        "SELLER_DOMAIN_UNVERIFIED",
        "ROUTE_TEMPLATE_INVALID"
      ])
    );
  });
});
