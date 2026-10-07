import { describe, expect, it } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";
import { testAssetContractId, testPaymentPayload, testPaymentRequest } from "@lumenbazaar/testkit";

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

describe("SettlementService", () => {
  it("settles a verified exact payment and stores transaction evidence", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const settlementStore = new InMemorySettlementStore();
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, { adapter, attemptStore });
    const settlement = new SettlementService(config, { adapter, attemptStore, settlementStore });
    const verified = await verification.verify(testPaymentRequest);

    await expect(
      settlement.settle({
        ...testPaymentRequest
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
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, { adapter, attemptStore });
    const settlement = new SettlementService(config, { adapter, attemptStore });
    await verification.verify(testPaymentRequest);

    await expect(
      settlement.settle({
        ...testPaymentRequest,
        paymentPayload: {
          ...testPaymentPayload,
          payload: {
            transaction: Buffer.from("different-transaction-xdr").toString("base64")
          }
        }
      })
    ).rejects.toMatchObject({
      code: "INVALID_PAYMENT_PAYLOAD"
    });
  });
});
