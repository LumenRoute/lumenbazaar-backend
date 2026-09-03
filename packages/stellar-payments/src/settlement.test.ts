import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import {
  InMemoryPaymentAttemptStore,
  InMemorySettlementStore,
  PaymentVerificationService,
  SettlementService,
  type X402StellarAdapter
} from "./index.js";

const adapter: X402StellarAdapter = {
  async verifyExact() {
    return {
      valid: true,
      adapter: "@x402/stellar"
    };
  },
  async settleExact() {
    return {
      transactionHash: "tx_exact_123",
      ledger: 12345,
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

describe("SettlementService", () => {
  it("settles a verified exact payment and stores transaction evidence", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const settlementStore = new InMemorySettlementStore();
    const config = loadConfig({});
    const verification = new PaymentVerificationService(config, { adapter, attemptStore });
    const settlement = new SettlementService(config, { adapter, attemptStore, settlementStore });
    const verified = await verification.verify(request());

    await expect(
      settlement.settle({
        paymentAttemptId: verified.paymentAttemptId,
        ...request()
      })
    ).resolves.toMatchObject({
      transactionHash: "tx_exact_123",
      ledger: 12345,
      network: "stellar:testnet",
      status: "settled"
    });

    await expect(settlement.getSettlementByTransactionHash("tx_exact_123")).resolves.toMatchObject({
      paymentAttemptId: verified.paymentAttemptId,
      status: "settled"
    });
  });

  it("rejects settlement when the payload differs from the verified attempt", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const config = loadConfig({});
    const verification = new PaymentVerificationService(config, { adapter, attemptStore });
    const settlement = new SettlementService(config, { adapter, attemptStore });
    const verified = await verification.verify(request());

    await expect(
      settlement.settle({
        paymentAttemptId: verified.paymentAttemptId,
        ...request(),
        paymentPayload: {
          ...request().paymentPayload,
          amount: "0.06"
        }
      })
    ).rejects.toMatchObject({
      code: "AMOUNT_MISMATCH"
    });
  });
});
