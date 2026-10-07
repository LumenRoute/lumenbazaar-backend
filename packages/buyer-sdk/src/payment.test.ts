import { afterEach, describe, expect, it, vi } from "vitest";

import { testPaymentPayload, testPaymentRequirement } from "@lumenbazaar/testkit";

import {
  createPaymentHeaders,
  createPaymentPayloadFromResource,
  deserializePaymentPayload,
  preparePaymentPayload,
  serializePaymentPayload,
  settlePayment,
  validatePaymentPayload,
  verifyPayment
} from "./payment.js";

describe("buyer SDK payment helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prepares and validates official x402 v2 Stellar payloads", () => {
    const payload = preparePaymentPayload({
      paymentRequirements: testPaymentRequirement,
      transaction: testPaymentPayload.payload.transaction
    });

    expect(payload).toEqual(testPaymentPayload);
    expect(validatePaymentPayload(payload)).toEqual({ valid: true, errors: [] });
  });

  it("creates payloads from requirements and round-trips PAYMENT-SIGNATURE", () => {
    const payload = createPaymentPayloadFromResource(testPaymentRequirement, {
      transaction: testPaymentPayload.payload.transaction,
      resource: {
        url: "https://seller.example/weather"
      }
    });
    const encoded = serializePaymentPayload(payload);

    expect(createPaymentHeaders(payload)).toEqual({
      "PAYMENT-SIGNATURE": encoded
    });
    expect(deserializePaymentPayload(encoded)).toEqual(payload);
  });

  it("rejects non-canonical transaction encodings", () => {
    expect(() =>
      preparePaymentPayload({
        paymentRequirements: testPaymentRequirement,
        transaction: "not base64"
      })
    ).toThrow("canonical base64");
  });

  it("posts official verify and settle requests to the facilitator API", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/verify")) {
        return Response.json({
          isValid: true,
          extra: {
            lumenbazaar: {
              adapter: "@x402/stellar",
              network: "stellar:testnet",
              paymentAttemptId: "attempt_1",
              paymentHash: "hash",
              status: "verified"
            }
          }
        });
      }

      return Response.json({
        success: true,
        network: "stellar:testnet",
        amount: "500000",
        transaction: "tx_1",
        extra: {
          lumenbazaar: {
            ledger: 10,
            receiptId: "receipt_1",
            settlementId: "settlement_1",
            status: "settled",
            transactionHash: "tx_1"
          }
        }
      });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const request = {
      x402Version: 2 as const,
      paymentPayload: testPaymentPayload,
      paymentRequirements: testPaymentRequirement
    };

    await expect(verifyPayment("https://api.example.test", request)).resolves.toMatchObject({
      isValid: true,
      extra: { lumenbazaar: { paymentAttemptId: "attempt_1" } }
    });
    await expect(settlePayment("https://api.example.test", request)).resolves.toMatchObject({
      success: true,
      extra: { lumenbazaar: { receiptId: "receipt_1" } }
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.example.test/v1/verify",
      expect.objectContaining({ method: "POST", body: JSON.stringify(request) })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.example.test/v1/settle",
      expect.objectContaining({ method: "POST", body: JSON.stringify(request) })
    );
  });
});
