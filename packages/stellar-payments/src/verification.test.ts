import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey, type LumenError } from "@lumenbazaar/shared";

import { PaymentVerificationService, type X402StellarAdapter } from "./index.js";

const acceptingAdapter: X402StellarAdapter = {
  async verifyExact() {
    return {
      valid: true,
      adapter: "@x402/stellar"
    };
  }
};

const rejectingAdapter: X402StellarAdapter = {
  async verifyExact() {
    return {
      valid: false,
      failureCode: "INVALID_SIGNATURE",
      failureReason: "Signature rejected.",
      adapter: "@x402/stellar"
    };
  }
};

function request() {
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

describe("PaymentVerificationService", () => {
  it("accepts valid exact payments through the x402 Stellar adapter", async () => {
    const service = new PaymentVerificationService(loadConfig({}), { adapter: acceptingAdapter });

    await expect(service.verify(request())).resolves.toMatchObject({
      network: "stellar:testnet",
      status: "verified",
      adapter: "@x402/stellar"
    });
  });

  it("rejects invalid payment details before settlement", async () => {
    const service = new PaymentVerificationService(loadConfig({}), { adapter: acceptingAdapter });
    const invalid = {
      ...request(),
      paymentPayload: {
        ...request().paymentPayload,
        amount: "0.01"
      }
    };

    await expect(service.verify(invalid)).rejects.toMatchObject({
      code: "AMOUNT_MISMATCH"
    });
  });

  it("maps x402 Stellar verification rejection to a stable code", async () => {
    const service = new PaymentVerificationService(loadConfig({}), { adapter: rejectingAdapter });

    await expect(service.verify(request())).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
      message: "Signature rejected."
    } satisfies Partial<LumenError>);
  });
});
