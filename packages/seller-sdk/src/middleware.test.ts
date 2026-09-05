import { describe, expect, it, vi } from "vitest";

import {
  createFastifyPaymentMiddleware,
  createPaymentRequired,
  type FastifyPaymentPluginHost,
  paymentRequirement,
  sendFastifyPaymentRequired
} from "./index.js";

const requirement = paymentRequirement({
  network: "stellar:testnet",
  assetCode: "USDC",
  assetIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  amount: "0.05",
  payTo: "GBZXN7PIRZGNMHGAIQW7QEJWW36L5CVVNRYANMDW2G3QOF2VCR4DQSQE"
});

describe("seller SDK middleware", () => {
  it("creates a stable x402 payment-required response", () => {
    expect(createPaymentRequired(requirement)).toMatchObject({
      status: 402,
      headers: {
        "x-payment-scheme": "exact"
      },
      body: {
        paymentRequired: {
          amount: "0.05"
        }
      }
    });
  });

  it("sends Fastify 402 responses with x402 headers", () => {
    const reply = {
      code: vi.fn(() => reply),
      header: vi.fn(() => reply),
      send: vi.fn()
    };

    sendFastifyPaymentRequired(reply, requirement);

    expect(reply.code).toHaveBeenCalledWith(402);
    expect(reply.header).toHaveBeenCalledWith("x-payment-scheme", "exact");
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentRequired: expect.objectContaining({
          amount: "0.05"
        })
      })
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
