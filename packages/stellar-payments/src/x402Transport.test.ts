import { describe, expect, it } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";
import {
  testAssetContractId,
  testPaymentPayload,
  testPaymentRequirement
} from "@lumenbazaar/testkit";

import {
  decodePaymentRequiredV2,
  decodePaymentSignatureV2,
  encodePaymentRequiredV2,
  encodePaymentSignatureV2,
  paymentRequiredHeader,
  paymentSignatureHeader
} from "./x402Transport.js";

const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });

describe("x402 v2 HTTP transport", () => {
  it("round trips canonical PAYMENT-REQUIRED base64", () => {
    const paymentRequired = {
      x402Version: 2 as const,
      resource: {
        url: "https://weather.example.test/weather/Lagos",
        description: "Paid weather"
      },
      accepts: [testPaymentRequirement]
    };

    expect(decodePaymentRequiredV2(encodePaymentRequiredV2(paymentRequired))).toEqual(
      paymentRequired
    );
  });

  it("round trips canonical PAYMENT-SIGNATURE base64", () => {
    const encoded = encodePaymentSignatureV2(testPaymentPayload);
    expect(decodePaymentSignatureV2(encoded, testPaymentRequirement, config)).toEqual(
      testPaymentPayload
    );
  });

  it.each([
    [paymentRequiredHeader, () => decodePaymentRequiredV2("not-base64!")],
    [
      paymentSignatureHeader,
      () => decodePaymentSignatureV2("not-base64!", testPaymentRequirement, config)
    ]
  ])("maps malformed %s values to stable protocol errors", (header, decode) => {
    expect(decode).toThrow(
      expect.objectContaining({
        code: "INVALID_PAYMENT_PAYLOAD",
        details: expect.objectContaining({ header })
      })
    );
  });
});
