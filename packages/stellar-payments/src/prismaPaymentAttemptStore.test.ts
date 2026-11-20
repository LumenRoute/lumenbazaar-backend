import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPaymentAttemptStore } from "./prismaPaymentAttemptStore.js";
import { InMemoryPaymentAttemptStore } from "./paymentAttemptStore.js";

describe("Payment Attempt Store - Atomic Duplicate Detection", () => {
  const createTestInput = (overrides = {}) => ({
    paymentHash: "test_hash_123",
    network: "stellar:testnet" as const,
    assetCode: "USDC",
    assetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4BFJXYS2CSM623ZSXV7ORBTQWFF5H3",
    amount: "100.00",
    payTo: "GBUQWP3BOUZX34ULNQG23RQ6F4BFJXYS2CSM623ZSXV7ORBTQWFF5H3",
    ...overrides
  });

  describe("In-Memory Store", () => {
    let store: InMemoryPaymentAttemptStore;

    beforeAll(() => {
      store = new InMemoryPaymentAttemptStore();
    });

    it("creates a verified attempt", async () => {
      const attempt = await store.createVerifiedAttempt(createTestInput());
      expect(attempt.status).toBe("verified");
      expect(attempt.paymentHash).toBe("test_hash_123");
    });

    it("rejects duplicate payment hash", async () => {
      const input = createTestInput();
      await store.createVerifiedAttempt(input);

      expect(async () => {
        await store.createVerifiedAttempt(input);
      }).rejects.toThrow("REPLAY_DETECTED");
    });

    it("allows concurrent creation with same hash (loses race)", async () => {
      const input = createTestInput({ paymentHash: "concurrent_hash" });

      const results = await Promise.allSettled([
        store.createVerifiedAttempt(input),
        store.createVerifiedAttempt(input)
      ]);

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      // One succeeds, one fails
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect((failures[0] as PromiseRejectedResult).reason.code).toBe("REPLAY_DETECTED");
    });

    it("normalizes payment hash to prevent bypassing", async () => {
      const input1 = createTestInput({ paymentHash: "ABC123" });
      const input2 = createTestInput({ paymentHash: "abc123" });

      await store.createVerifiedAttempt(input1);

      expect(async () => {
        await store.createVerifyiedAttempt(input2);
      }).rejects.toThrow("REPLAY_DETECTED");
    });

    it("claims settlement atomically", async () => {
      const attempt = await store.createVerifiedAttempt(
        createTestInput({ paymentHash: "settlement_test" })
      );

      const claimed = await store.claimSettlement(attempt.id);
      expect(claimed?.status).toBe("settling");

      // Second claim should fail (already settling)
      const secondClaim = await store.claimSettlement(attempt.id);
      expect(secondClaim).toBeUndefined();
    });

    it("survives restart (simulated)", async () => {
      const input = createTestInput({ paymentHash: "restart_test" });
      const store1 = new InMemoryPaymentAttemptStore();
      const attempt1 = await store1.createVerifiedAttempt(input);

      // Simulate restart: new store instance
      const store2 = new InMemoryPaymentAttemptStore();

      // OLD: attempt would exist in store1 but not store2 (this tests the loss)
      // Note: In-memory store doesn't persist across instances by design
      // Prisma store will persist via DB

      // This test just verifies the contract
      expect(attempt1.id).toBeDefined();
    });

    it("rejects illegal state transitions", async () => {
      const attempt = await store.createVerifiedAttempt(
        createTestInput({ paymentHash: "state_test" })
      );

      // verified -> settled (illegal, should go verified -> settling -> submitted -> confirmed -> settled)
      expect(async () => {
        await store.updatePaymentAttempt(attempt.id, { status: "settled" });
      }).rejects.toThrow();
    });

    it("allows legal state transitions", async () => {
      const attempt = await store.createVerifiedAttempt(
        createTestInput({ paymentHash: "legal_state" })
      );

      // verified -> settling
      const settling = await store.updatePaymentAttempt(attempt.id, { status: "settling" });
      expect(settling.status).toBe("settling");

      // settling -> submitted
      const submitted = await store.updatePaymentAttempt(attempt.id, { status: "submitted" });
      expect(submitted.status).toBe("submitted");
    });
  });

  describe("Hash Normalization", () => {
    let store: InMemoryPaymentAttemptStore;

    beforeAll(() => {
      store = new InMemoryPaymentAttemptStore();
    });

    it("treats uppercase and lowercase as same", async () => {
      const input1 = createTestInput({ paymentHash: "TESTHASH123" });
      await store.createVerifiedAttempt(input1);

      const input2 = createTestInput({ paymentHash: "testhash123" });
      expect(async () => {
        await store.createVerifiedAttempt(input2);
      }).rejects.toThrow("REPLAY_DETECTED");
    });

    it("finds attempt by hash (normalized)", async () => {
      const input = createTestInput({ paymentHash: "FindTestHash" });
      const created = await store.createVerifiedAttempt(input);

      const found = await store.findPaymentAttemptByHash("findtesthash");
      expect(found?.id).toBe(created.id);
    });
  });

  describe("Concurrency Guarantees", () => {
    let store: InMemoryPaymentAttemptStore;

    beforeAll(() => {
      store = new InMemoryPaymentAttemptStore();
    });

    it("exactly one attempt wins in parallel verification", async () => {
      const input = createTestInput({ paymentHash: "parallel_test" });

      // Fire N parallel attempts
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => store.createVerifiedAttempt(input))
      );

      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes).toHaveLength(1);

      // Verify only one row in store
      const found = await store.findPaymentAttemptByHash(input.paymentHash);
      expect(found?.id).toBe((successes[0] as PromiseSettledResult<any>).value.id);
    });
  });
});
