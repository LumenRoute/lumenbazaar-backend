import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPaymentPayloadFromResource,
  preparePaymentPayload,
  settlePayment,
  validatePaymentPayload,
  verifyPayment
} from "./payment.js";

describe("buyer SDK payment helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prepares backend-compatible payment payloads using payTo", () => {
    const payload = preparePaymentPayload({
      network: "stellar:testnet",
      assetCode: "USDC",
      assetIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: "0.05",
      payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE",
      expiresAtLedger: 123
    });

    expect(payload).toMatchObject({
      payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE",
      expiresAtLedger: 123
    });
    expect(validatePaymentPayload(payload)).toEqual({ valid: true, errors: [] });
  });

  it("creates payment payloads from inspected resource terms", () => {
    expect(
      createPaymentPayloadFromResource(
        {
          network: "stellar:testnet",
          asset: {
            code: "USDC",
            issuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
          },
          amount: "0.05",
          payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE"
        },
        {
          authorization: {
            signature: "sig"
          }
        }
      )
    ).toMatchObject({
      authorization: {
        signature: "sig"
      },
      payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE"
    });
  });

  it("posts verify and settle requests to the facilitator API", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/verify")) {
        return Response.json({
          adapter: "@x402/stellar",
          network: "stellar:testnet",
          paymentAttemptId: "attempt_1",
          paymentHash: "hash",
          status: "verified"
        });
      }

      return Response.json({
        ledger: 10,
        network: "stellar:testnet",
        receiptId: "receipt_1",
        settlementId: "settlement_1",
        status: "settled",
        transactionHash: "tx_1"
      });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const paymentPayload = preparePaymentPayload({
      network: "stellar:testnet",
      assetCode: "USDC",
      assetIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: "0.05",
      payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE"
    });
    const paymentRequirements = {
      scheme: "exact" as const,
      network: "stellar:testnet" as const,
      amount: "0.05",
      payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE"
    };

    await expect(
      verifyPayment("https://api.example.test", {
        paymentPayload,
        paymentRequirements
      })
    ).resolves.toMatchObject({ paymentAttemptId: "attempt_1" });
    await expect(
      settlePayment("https://api.example.test", {
        paymentAttemptId: "attempt_1",
        paymentPayload,
        paymentRequirements
      })
    ).resolves.toMatchObject({ receiptId: "receipt_1" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/v1/verify",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/v1/settle",
      expect.objectContaining({ method: "POST" })
    );
  });
});
