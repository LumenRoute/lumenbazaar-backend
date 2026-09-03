import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import {
  InMemoryPaymentAttemptStore,
  PaymentVerificationService,
  type X402StellarAdapter
} from "./index.js";

const acceptingAdapter: X402StellarAdapter = {
  async verifyExact() {
    return {
      valid: true,
      adapter: "@x402/stellar"
    };
  }
};

function request() {
  return {
    resourceId: "resource_1",
    sellerId: "seller_1",
    paymentPayload: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo: localIssuerPublicKey,
      expiresAtLedger: 100,
      authorization: {
        signature: "sig"
      }
    },
    paymentRequirements: {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "0.05",
      payTo: localIssuerPublicKey
    },
    currentLedger: 99
  };
}

describe("replay protection", () => {
  it("stores verified payment attempts and rejects duplicate hashes", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const service = new PaymentVerificationService(loadConfig({}), {
      adapter: acceptingAdapter,
      attemptStore
    });

    const first = await service.verify(request());
    const stored = await attemptStore.getPaymentAttempt(first.paymentAttemptId);

    expect(stored).toMatchObject({
      paymentHash: first.paymentHash,
      resourceId: "resource_1",
      sellerId: "seller_1",
      status: "verified"
    });
    await expect(service.verify(request())).rejects.toMatchObject({
      code: "REPLAY_DETECTED"
    });
  });
});
