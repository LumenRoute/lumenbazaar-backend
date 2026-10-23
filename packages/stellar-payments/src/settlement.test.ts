import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";
import { testAssetContractId, testPaymentPayload, testPaymentRequest } from "@lumenbazaar/testkit";
import { type SubmittedPaymentStateInput } from "./paymentStatePersistence.js";

import {
  InMemoryPaymentAttemptStore,
  InMemorySettlementStore,
  PaymentVerificationService,
  ReceiptService,
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
  it("reclaims only a stale pre-submit settlement claim", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const attempt = await attemptStore.createVerifiedAttempt({
      paymentHash: "payment_hash_stale_claim",
      network: "stellar:testnet",
      assetCode: "USDC",
      assetIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      amount: "500000",
      payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
    });

    await expect(attemptStore.claimSettlement(attempt.id)).resolves.toMatchObject({
      status: "settling"
    });
    await expect(attemptStore.claimSettlement(attempt.id)).resolves.toBeUndefined();
    await expect(
      attemptStore.claimSettlement(attempt.id, new Date(Date.now() + 1000).toISOString())
    ).resolves.toMatchObject({ status: "settling" });
  });

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

    await expect(settlement.getSettlementByTransactionHash("tx_exact_123", "stellar:testnet")).resolves.toMatchObject({
      paymentAttemptId: verified.paymentAttemptId,
      status: "confirmed"
    });
  });

  it("converges concurrent and repeated settlement requests on one result", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const settlementStore = new InMemorySettlementStore();
    const receiptService = new ReceiptService();
    const settleExact = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        transactionHash: "tx_concurrent_123",
        ledger: 12346,
        status: "confirmed" as const,
        adapter: "@x402/stellar" as const
      };
    });
    const concurrentAdapter: X402StellarAdapter = {
      verifyExact: adapter.verifyExact,
      settleExact
    };
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, {
      adapter: concurrentAdapter,
      attemptStore
    });
    const services = [
      new SettlementService(config, {
        adapter: concurrentAdapter,
        attemptStore,
        settlementStore,
        receiptService
      }),
      new SettlementService(config, {
        adapter: concurrentAdapter,
        attemptStore,
        settlementStore,
        receiptService
      })
    ];
    await verification.verify(testPaymentRequest);

    const [first, concurrent] = await Promise.all(
      services.map(async (service) => service.settle(testPaymentRequest))
    );
    const retry = await services[0]!.settle(testPaymentRequest);

    expect(concurrent).toEqual(first);
    expect(retry).toEqual(first);
    expect(settleExact).toHaveBeenCalledTimes(1);
  });

  it("resumes confirmation after a crash following submission intent without resubmitting", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const settlementStore = new InMemorySettlementStore();
    const receiptService = new ReceiptService();
    let submittedToNetwork = 0;
    const settleExact = vi.fn(async (input: Parameters<NonNullable<X402StellarAdapter["settleExact"]>>[0]) => {
      await input.onTransactionPrepared?.("tx_crash_window");
      submittedToNetwork += 1;
      throw new Error("simulated crash after network submission");
    });
    const crashAdapter: X402StellarAdapter = {
      async verifyExact() {
        return { valid: true, adapter: "@x402/stellar" };
      },
      settleExact
    };
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, {
      adapter: crashAdapter,
      attemptStore
    });
    const verified = await verification.verify(testPaymentRequest);
    const enqueue = vi.fn(async () => undefined);
    const statePersistence = {
      async recordSubmission({ attempt, settlement: intent }: SubmittedPaymentStateInput) {
        const submittedAttempt = await attemptStore.updatePaymentAttempt(attempt.id, {
          status: "submitted"
        });
        const settlement = await settlementStore.createSettlement(intent);
        const receipt = await receiptService.finalizeSettlementReceipt(submittedAttempt, settlement);
        return { attempt: submittedAttempt, settlement, receipt };
      }
    } as never;
    const settlement = new SettlementService(config, {
      adapter: crashAdapter,
      attemptStore,
      settlementStore,
      receiptService,
      statePersistence,
      reconciliationScheduler: { enqueue }
    });

    await expect(settlement.settle(testPaymentRequest)).rejects.toThrow(
      "simulated crash after network submission"
    );
    await expect(settlement.settle(testPaymentRequest)).rejects.toMatchObject({
      code: "SETTLEMENT_FAILED",
      statusCode: 409,
      details: { status: "submitted", transactionHash: "tx_crash_window" }
    });

    expect(settleExact).toHaveBeenCalledTimes(1);
    expect(submittedToNetwork).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentAttemptId: verified.paymentAttemptId,
        transactionHash: "tx_crash_window"
      })
    );
    await expect(attemptStore.getPaymentAttempt(verified.paymentAttemptId)).resolves.toMatchObject({
      status: "submitted"
    });
  });

  it("rejects a conflicting request fingerprint under the settlement idempotency key", async () => {
    const attemptStore = new InMemoryPaymentAttemptStore();
    const settlementStore = new InMemorySettlementStore();
    const settleExact = vi.fn(adapter.settleExact);
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, { adapter, attemptStore });
    const settlement = new SettlementService(config, {
      adapter: { ...adapter, settleExact },
      attemptStore,
      settlementStore
    });
    const verified = await verification.verify(testPaymentRequest);
    const attempt = await attemptStore.getPaymentAttempt(verified.paymentAttemptId);
    if (attempt === undefined) {
      throw new Error("verified attempt missing");
    }
    await settlementStore.createSettlement({
      paymentAttemptId: attempt.id,
      idempotencyKey: `settle:${attempt.id}`,
      requestHash: "conflicting-payload-hash",
      transactionHash: "tx_existing_intent",
      network: attempt.network,
      amount: attempt.amount,
      assetCode: attempt.assetCode,
      assetIssuer: attempt.assetIssuer,
      status: "submitted",
      reconciliationState: "pending"
    });

    await expect(settlement.settle(testPaymentRequest)).rejects.toMatchObject({
      code: "REPLAY_DETECTED"
    });
    expect(settleExact).not.toHaveBeenCalled();
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
    const settleExact = vi.fn(async () => ({
      status,
      transactionHash: hash,
      failureCode: "SETTLEMENT_FAILED" as const,
      failureReason: `Settlement ${status}.`,
      officialContext: { stage: status === "timed_out" ? "timeout" : "failed" },
      adapter: "@x402/stellar" as const
    }));
    const failingAdapter: X402StellarAdapter = {
      async verifyExact() {
        return { valid: true, adapter: "@x402/stellar" };
      },
      settleExact
    };
    const enqueue = vi.fn(async () => undefined);
    const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
    const verification = new PaymentVerificationService(config, {
      adapter: failingAdapter,
      attemptStore
    });
    const settlement = new SettlementService(config, {
      adapter: failingAdapter,
      attemptStore,
      settlementStore,
      reconciliationScheduler: { enqueue }
    });
    const verified = await verification.verify(testPaymentRequest);

    await expect(settlement.settle(testPaymentRequest)).rejects.toMatchObject({
      code: "SETTLEMENT_FAILED",
      details: { status, transactionHash: hash }
    });
    await expect(settlement.getSettlementByTransactionHash(hash, "stellar:testnet")).resolves.toMatchObject({
      paymentAttemptId: verified.paymentAttemptId,
      status
    });
    await expect(attemptStore.getPaymentAttempt(verified.paymentAttemptId)).resolves.toMatchObject({
      status
    });
    await expect(settlement.settle(testPaymentRequest)).rejects.toMatchObject({
      code: "SETTLEMENT_FAILED",
      details: { status, transactionHash: hash }
    });
    expect(settleExact).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
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
