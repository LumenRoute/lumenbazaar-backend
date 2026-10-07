import { decodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, it, vi } from "vitest";

import { testAssetContractId } from "@lumenbazaar/testkit";

import {
  createFastifyPaymentMiddleware,
  createPaymentRequired,
  type FastifyPaymentPluginHost,
  paymentRequirement,
  sendFastifyPaymentRequired
} from "./index.js";

const requirement = paymentRequirement({
  network: "stellar:testnet",
  assetContractId: testAssetContractId,
  assetCode: "USDC",
  assetIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  amount: "500000",
  payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE"
});

describe("seller SDK middleware", () => {
  it("creates an official x402 v2 payment-required response", () => {
    const response = createPaymentRequired(requirement, {
      url: "https://seller.example/weather"
    });

    expect(response).toMatchObject({
      status: 402,
      body: {
        x402Version: 2,
        accepts: [{ amount: "500000", asset: testAssetContractId }]
      }
    });
    expect(decodePaymentRequiredHeader(response.headers["payment-required"])).toEqual(
      response.body
    );
  });

  it("sends Fastify 402 responses with PAYMENT-REQUIRED", () => {
    const reply = {
      code: vi.fn(() => reply),
      header: vi.fn(() => reply),
      send: vi.fn()
    };

    sendFastifyPaymentRequired(reply, requirement);

    expect(reply.code).toHaveBeenCalledWith(402);
    expect(reply.header).toHaveBeenCalledWith("PAYMENT-REQUIRED", expect.any(String));
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ x402Version: 2, accepts: [requirement] })
    );
  });

  it("decorates Fastify with a reusable payment guard", async () => {
    let decorated: Parameters<FastifyPaymentPluginHost["decorate"]>[1] | undefined;

    await createFastifyPaymentMiddleware(requirement)({
      decorate(_name, value) {
        decorated = value;
      }
    });

    expect(decorated?.requirePayment).toEqual(expect.any(Function));
  });
});
