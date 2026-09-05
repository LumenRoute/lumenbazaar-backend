import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { AuditLogService } from "./audit.js";
import { CatalogService } from "./cataloging.js";
import { CatalogValidationService } from "./catalogValidation.js";
import { ResourceService } from "./resources.js";
import { SellerService } from "./sellers.js";

describe("API audit integrations", () => {
  it("records seller domain verification without storing challenge evidence", async () => {
    const auditLogService = new AuditLogService();
    const sellerService = new SellerService(undefined, auditLogService);
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const challenge = await sellerService.verifyDomain(seller.id, { method: "dns" });

    await sellerService.verifyDomain(seller.id, {
      evidence: challenge.challenge
    });

    const records = await auditLogService.list();
    expect(records.map((record) => record.action)).toEqual([
      "seller.domain.challenge_created",
      "seller.domain.verified"
    ]);
    expect(JSON.stringify(records)).not.toContain(challenge.challengeToken);
    expect(records[1]).toMatchObject({
      actorType: "seller",
      actorId: seller.id,
      targetType: "seller_domain",
      metadata: {
        domain: "seller.example",
        method: "dns",
        verified: true
      }
    });
  });

  it("records cataloging decisions without payment payload data", async () => {
    const auditLogService = new AuditLogService();
    const config = loadConfig({});
    const sellerService = new SellerService(undefined, auditLogService);
    const resourceService = new ResourceService(config, sellerService);
    const catalogService = new CatalogService(
      new CatalogValidationService(config, sellerService),
      resourceService,
      { auditLogService }
    );
    const seller = await sellerService.createSeller({
      displayName: "Catalog Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    await catalogService.catalog({
      sellerId: seller.id,
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
    });

    await expect(auditLogService.list()).resolves.toContainEqual(
      expect.objectContaining({
        action: "resource.catalog",
        actorId: seller.id,
        targetType: "resource",
        metadata: expect.objectContaining({
          assetCode: "USDC",
          network: "stellar:testnet",
          routeTemplate: "/weather/{city}",
          status: "active"
        })
      })
    );
    expect(JSON.stringify(await auditLogService.list())).not.toContain("paymentPayload");
  });
});
