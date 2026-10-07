import { describe, expect, it, vi } from "vitest";

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
      status: "confirmed",
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
      status: "confirmed"
    });

    await expect(settlement.getSettlementByTransactionHash("tx_exact_123")).resolves.toMatchObject({
      paymentAttemptId: verified.paymentAttemptId,
      status: "confirmed"
    });
  });

  it("independently re-verifies immediately before official settlement", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const verifyExact = vi.fn(adapter.verifyExact);
    const settlementAdapter: X402StellarAdapter = { ...adapter, verifyExact };
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, {
      adapter: settlementAdapter,
      attemptStore
    });
    const settlement = new SettlementService(config, {
      adapter: settlementAdapter,
      attemptStore
    });
    await verification.verify(testPaymentRequest);

    await settlement.settle(testPaymentRequest);

    expect(verifyExact).toHaveBeenCalledTimes(2);
  });

  it("rejects a simulation result that changes after the earlier verification", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const settleExact = vi.fn(adapter.settleExact);
    const changingAdapter: X402StellarAdapter = {
      verifyExact: vi
        .fn()
        .mockResolvedValueOnce({ valid: true, adapter: "@x402/stellar" })
        .mockResolvedValueOnce({
          valid: false,
          failureCode: "AMOUNT_MISMATCH",
          failureReason: "Fresh simulation amount changed.",
          officialContext: { invalidReason: "invalid_exact_stellar_payload_event_wrong_amount" },
          adapter: "@x402/stellar"
        }),
      settleExact
    };
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, {
      adapter: changingAdapter,
      attemptStore
    });
    const settlement = new SettlementService(config, {
      adapter: changingAdapter,
      attemptStore
    });
    await verification.verify(testPaymentRequest);

    await expect(settlement.settle(testPaymentRequest)).rejects.toMatchObject({
      code: "AMOUNT_MISMATCH",
      details: {
        stage: "simulation",
        invalidReason: "invalid_exact_stellar_payload_event_wrong_amount"
      }
    });
    expect(settleExact).not.toHaveBeenCalled();
  });

  it.each([
    ["timed_out", "tx_timeout"],
    ["failed", "tx_failed"]
  ] as const)("persists %s finality without issuing a success response", async (status, hash) => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const settlementStore = new InMemorySettlementStore();
    const failingAdapter: X402StellarAdapter = {
      async verifyExact() {
        return { valid: true, adapter: "@x402/stellar" };
      },
      async settleExact() {
        return {
          status,
          transactionHash: hash,
          failureCode: "SETTLEMENT_FAILED",
          failureReason: `Settlement ${status}.`,
          officialContext: { stage: status === "timed_out" ? "timeout" : "failed" },
          adapter: "@x402/stellar"
        };
      }
    };
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, {
      adapter: failingAdapter,
      attemptStore
    });
    const settlement = new SettlementService(config, {
      adapter: failingAdapter,
      attemptStore,
      settlementStore
    });
    const verified = await verification.verify(testPaymentRequest);

    await expect(settlement.settle(testPaymentRequest)).rejects.toMatchObject({
      code: "SETTLEMENT_FAILED",
      details: { status, transactionHash: hash }
    });
    await expect(settlement.getSettlementByTransactionHash(hash)).resolves.toMatchObject({
      paymentAttemptId: verified.paymentAttemptId,
      status
    });
    await expect(attemptStore.getPaymentAttempt(verified.paymentAttemptId)).resolves.toMatchObject({
      status
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
