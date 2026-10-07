import { describe, expect, it } from "vitest";

import { LumenError, loadConfig } from "@lumenbazaar/shared";
import {
  testAssetContractId,
  testPaymentPayload,
  testPaymentRequest,
  testPaymentRequirement,
  testMalformedPaymentRequest,
  testWrongAssetPaymentRequest,
  testWrongNetworkPaymentRequest,
  testWrongSchemePaymentRequest,
  testWrongVersionPaymentRequest
} from "@lumenbazaar/testkit";

import { parseVerifyPaymentRequest } from "./index.js";

const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });

describe("official x402 v2 Stellar payment model", () => {
  it("parses the official v2 payload and SEP-41 asset requirement", () => {
    expect(parseVerifyPaymentRequest(testPaymentRequest, config)).toMatchObject({
      x402Version: 2,
      network: "stellar:testnet",
      amount: "500000",
      asset: {
        contractId: testAssetContractId,
        decimals: 7
      },
      paymentPayload: {
        accepted: testPaymentRequirement,
        payload: testPaymentPayload.payload
      }
    });
  });

  it.each([
    ["wrong version", "INVALID_PAYMENT_PAYLOAD", testWrongVersionPaymentRequest],
    ["wrong network", "UNSUPPORTED_NETWORK", testWrongNetworkPaymentRequest],
    ["wrong scheme", "INVALID_PAYMENT_PAYLOAD", testWrongSchemePaymentRequest],
    ["wrong asset", "UNSUPPORTED_ASSET", testWrongAssetPaymentRequest],
    ["malformed transaction base64", "INVALID_PAYMENT_PAYLOAD", testMalformedPaymentRequest]
  ])("rejects %s with a stable error", (_name, code, input) => {
    expect(() => parseVerifyPaymentRequest(input, config)).toThrow(LumenError);
    try {
      parseVerifyPaymentRequest(input, config);
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });

  it("rejects the former custom Stellar exact shape as v1", () => {
    expect(() =>
      parseVerifyPaymentRequest(
        {
          paymentPayload: {
            scheme: "exact",
            network: "stellar:testnet",
            amount: "0.05"
          },
          paymentRequirements: testPaymentRequirement
        },
        config
      )
    ).toThrow("x402 v1 Stellar exact payloads are not supported");
  });
});
