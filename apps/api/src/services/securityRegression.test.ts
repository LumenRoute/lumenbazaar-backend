import { describe, expect, it, vi } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";
import {
  createTestPaymentRequest,
  testExpiredPaymentRequest,
  testPaymentConfigEnv,
  testSeller
} from "@lumenbazaar/testkit";
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

const alternatePayTo = testSeller.walletAddress;

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

  it("returns an idempotent verification result and rejects expired authorizations", async () => {
    const verification = new PaymentVerificationService(loadConfig(testPaymentConfigEnv), {
      adapter: {
        async verifyExact(input) {
          const transaction = Buffer.from(
            input.paymentPayload.payload.transaction,
            "base64"
          ).toString();
          return transaction.includes("expired-ledger-bounds")
            ? {
                valid: false,
                failureCode: "AUTH_EXPIRED",
                failureReason: "Transaction ledger bounds have expired.",
                adapter: "@x402/stellar"
              }
            : { valid: true, adapter: "@x402/stellar" };
        }
      },
      attemptStore: new InMemoryPaymentAttemptStore()
    });

    const original = await verification.verify(exactPaymentRequest("security_replay"));
    await expect(verification.verify(exactPaymentRequest("security_replay"))).resolves.toEqual(
      original
    );
    await expect(verification.verify(testExpiredPaymentRequest)).rejects.toMatchObject({
      code: "AUTH_EXPIRED"
    });
  });

  it("rejects wrong asset and recipient settlement payloads before adapter settlement", async () => {
    const settleExact = vi.fn(async () => ({
      transactionHash: "tx_should_not_happen",
      ledger: 123,
      status: "confirmed" as const,
      adapter: "@x402/stellar" as const
    }));
    const adapter = {
      ...acceptingAdapter(),
      settleExact
    };
    const attemptStore = new InMemoryPaymentAttemptStore();
    const config = loadConfig(testPaymentConfigEnv);
    const verification = new PaymentVerificationService(config, { adapter, attemptStore });
    const settlement = new SettlementService(config, { adapter, attemptStore });
    const original = exactPaymentRequest("security_settlement");
    await verification.verify(original);

    const wrongAssetRequirements = {
      ...original.paymentRequirements,
      asset: "CUNSUPPORTEDASSETCONTRACT0000000000000000000000000000000"
    };

    await expect(
      settlement.settle({
        ...original,
        paymentPayload: {
          ...original.paymentPayload,
          accepted: wrongAssetRequirements
        },
        paymentRequirements: wrongAssetRequirements
      })
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_ASSET"
    });
    const wrongRecipientRequirements = {
      ...original.paymentRequirements,
      payTo: alternatePayTo
    };
    await expect(
      settlement.settle({
        ...original,
        paymentPayload: {
          ...original.paymentPayload,
          accepted: wrongRecipientRequirements
        },
        paymentRequirements: wrongRecipientRequirements
      })
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_PAYLOAD"
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
  return createTestPaymentRequest(paymentHash);
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
