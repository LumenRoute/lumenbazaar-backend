import { describe, expect, it, vi } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";
import {
  InMemoryPaymentAttemptStore,
  PaymentVerificationService,
  SettlementService,
  type X402StellarAdapter
} from "@lumenbazaar/stellar-payments";

import { CatalogValidationService } from "./catalogValidation.js";
import { ResourceService } from "./resources.js";
import { SearchService } from "./search.js";
import { SellerService } from "./sellers.js";

const alternatePayTo = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("security regressions", () => {
  it("rejects forged seller metadata and route templates", async () => {
    const sellerService = new SellerService();
    const seller = await sellerService.createSeller({
      displayName: "Weather Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });
    const catalogValidation = new CatalogValidationService(loadConfig({}), sellerService);

    const result = await catalogValidation.validate({
      ...metadata(seller.id),
      resource: {
        ...metadata(seller.id).resource,
        url: "https://evil.example/weather/Lagos",
        routeTemplate: "/weather/{../../secret}",
        extensions: {
          trusted: true
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "CATALOG_VALIDATION_FAILED",
        "ROUTE_TEMPLATE_INVALID",
        "SELLER_DOMAIN_UNVERIFIED"
      ])
    );
  });

  it("rejects replayed and expired exact payment authorizations", async () => {
    const verification = new PaymentVerificationService(loadConfig({}), {
      adapter: acceptingAdapter(),
      attemptStore: new InMemoryPaymentAttemptStore()
    });

    await verification.verify(exactPaymentRequest("security_replay"));

    await expect(verification.verify(exactPaymentRequest("security_replay"))).rejects.toMatchObject(
      {
        code: "REPLAY_DETECTED"
      }
    );
    await expect(
      verification.verify({
        ...exactPaymentRequest("security_expired"),
        currentLedger: 10
      })
    ).rejects.toMatchObject({
      code: "AUTH_EXPIRED"
    });
  });

  it("rejects wrong asset and recipient settlement payloads before adapter settlement", async () => {
    const settleExact = vi.fn(async () => ({
      transactionHash: "tx_should_not_happen",
      ledger: 123,
      adapter: "@x402/stellar" as const
    }));
    const adapter = {
      ...acceptingAdapter(),
      settleExact
    };
    const attemptStore = new InMemoryPaymentAttemptStore();
    const config = loadConfig({});
    const verification = new PaymentVerificationService(config, { adapter, attemptStore });
    const settlement = new SettlementService(config, { adapter, attemptStore });
    const verified = await verification.verify(exactPaymentRequest("security_settlement"));

    await expect(
      settlement.settle({
        paymentAttemptId: verified.paymentAttemptId,
        ...exactPaymentRequest("security_settlement"),
        paymentRequirements: {
          ...exactPaymentRequest("security_settlement").paymentRequirements,
          asset: {
            code: "XLM",
            issuer: localIssuerPublicKey
          }
        }
      })
    ).rejects.toMatchObject({
      code: "ASSET_MISMATCH"
    });
    await expect(
      settlement.settle({
        paymentAttemptId: verified.paymentAttemptId,
        ...exactPaymentRequest("security_settlement"),
        paymentRequirements: {
          ...exactPaymentRequest("security_settlement").paymentRequirements,
          payTo: alternatePayTo
        }
      })
    ).rejects.toMatchObject({
      code: "RECIPIENT_MISMATCH"
    });
    expect(settleExact).not.toHaveBeenCalled();
  });

  it("does not let arbitrary extension text poison discovery search results", async () => {
    const sellerService = new SellerService();
    const resourceService = new ResourceService(loadConfig({}), sellerService);
    const searchService = new SearchService(resourceService);
    const seller = await sellerService.createSeller({
      displayName: "Accounting Seller",
      walletAddress: localIssuerPublicKey,
      domain: "seller.example"
    });

    await resourceService.createResource({
      sellerId: seller.id,
      type: "http",
      name: "Invoice Export API",
      description: "Exports paid invoices as ledger-ready CSV data.",
      url: "https://seller.example/invoices/{account}",
      routeTemplate: "/invoices/{account}",
      network: "stellar:testnet",
      payTo: localIssuerPublicKey,
      assetCode: "USDC",
      assetIssuer: localIssuerPublicKey,
      amount: "0.05",
      inputSchema: {
        type: "object",
        properties: {
          account: {
            type: "string"
          }
        }
      },
      outputSchema: {
        type: "object"
      },
      extensions: {
        bazaar: true,
        injectedKeywords: "weather forecast alerts"
      }
    });

    await searchService.rebuildIndex();

    await expect(searchService.search({ q: "weather forecast" })).resolves.toMatchObject({
      resources: []
    });
  });
});

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

function exactPaymentRequest(paymentHash: string) {
  return {
    paymentPayload: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo: localIssuerPublicKey,
      expiresAtLedger: 10,
      authorization: {
        signature: "sig"
      },
      paymentHash
    },
    paymentRequirements: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo: localIssuerPublicKey
    },
    currentLedger: 9
  };
}

function acceptingAdapter(): X402StellarAdapter {
  return {
    async verifyExact() {
      return {
        valid: true,
        adapter: "@x402/stellar"
      };
    }
  };
}
