import { describe, expect, it, vi } from "vitest";

import { loadConfig, type LumenError } from "@lumenbazaar/shared";
import {
  testAssetContractId,
  testPaymentPayload,
  testPaymentRequest,
  testPaymentRequirement
} from "@lumenbazaar/testkit";

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
      officialContext: { invalidReason: "invalid_exact_stellar_payload" },
      adapter: "@x402/stellar"
    };
  }
};

const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });

describe("PaymentVerificationService", () => {
  it("accepts valid exact payments through the x402 Stellar adapter", async () => {
    const service = new PaymentVerificationService(config, { adapter: acceptingAdapter });

    await expect(service.verify(testPaymentRequest)).resolves.toMatchObject({
      network: "stellar:testnet",
      status: "verified",
      adapter: "@x402/stellar"
    });
  });

  it("returns the original attempt for an identical safe retry", async () => {
    const verifyExact = vi.fn(acceptingAdapter.verifyExact);
    const service = new PaymentVerificationService(config, {
      adapter: { verifyExact }
    });

    const first = await service.verify(testPaymentRequest);
    const retry = await service.verify(testPaymentRequest);

    expect(retry).toEqual(first);
    expect(verifyExact).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid payment details before settlement", async () => {
    const service = new PaymentVerificationService(config, { adapter: acceptingAdapter });
    const changedRequirement = { ...testPaymentRequirement, amount: "100000" };
    const invalid = {
      ...testPaymentRequest,
      paymentPayload: {
        ...testPaymentPayload,
        accepted: changedRequirement
      },
      paymentRequirements: testPaymentRequirement
    };

    await expect(service.verify(invalid)).rejects.toMatchObject({
      code: "INVALID_PAYMENT_PAYLOAD"
    });
  });

  it("maps x402 Stellar verification rejection to a stable code", async () => {
    const service = new PaymentVerificationService(config, { adapter: rejectingAdapter });

    await expect(service.verify(testPaymentRequest)).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
      message: "Signature rejected.",
      details: {
        adapter: "@x402/stellar",
        invalidReason: "invalid_exact_stellar_payload"
      }
    } satisfies Partial<LumenError>);
  });
});
