import { describe, expect, it } from "vitest";

import { localIssuerPublicKey } from "@lumenbazaar/shared";

import { SellerService } from "./sellers.js";

describe("SellerService", () => {
  it("creates and fetches sellers with validated Stellar wallets", async () => {
    const service = new SellerService();
    const seller = await service.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    await expect(service.getSeller(seller.id)).resolves.toEqual(seller);
  });

  it("rejects invalid seller wallet and domain values", async () => {
    const service = new SellerService();

    await expect(
      service.createSeller({
        displayName: "Bad Seller",
        walletAddress: "not-a-wallet",
        domain: "seller.example"
      })
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_PAYLOAD"
    });

    await expect(
      service.createSeller({
        displayName: "Bad Seller",
        walletAddress: localIssuerPublicKey,
        domain: "../seller"
      })
    ).rejects.toThrow("Domain is invalid");
  });

  it("creates and verifies seller domain challenges", async () => {
    const service = new SellerService();
    const seller = await service.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const challenge = await service.verifyDomain(seller.id, { method: "well-known" });

    expect(challenge).toMatchObject({
      sellerId: seller.id,
      domain: "seller.example",
      method: "well-known",
      verified: false
    });

    const verified = await service.verifyDomain(seller.id, { evidence: challenge.challenge });

    expect(verified.verified).toBe(true);
    await expect(service.getSeller(seller.id)).resolves.toMatchObject({
      domainVerifiedAt: expect.any(String)
    });
  });
});
