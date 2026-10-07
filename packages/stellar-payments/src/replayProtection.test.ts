import { describe, expect, it } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";
import { createTestPaymentRequest, testPaymentConfigEnv } from "@lumenbazaar/testkit";

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
  return createTestPaymentRequest("replay-protection");
}

describe("replay protection", () => {
  it("stores one verified attempt and reuses it for duplicate hashes", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const service = new PaymentVerificationService(loadConfig(testPaymentConfigEnv), {
      adapter: acceptingAdapter,
      attemptStore
    });

    const first = await service.verify(request());
    const stored = await attemptStore.getPaymentAttempt(first.paymentAttemptId);

    expect(stored).toMatchObject({
      paymentHash: first.paymentHash,
      status: "verified"
    });
    await expect(service.verify(request())).resolves.toEqual(first);
  });
});
