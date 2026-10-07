import { PrismaClient } from "@prisma/client";
import { type Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { disconnectPrismaClient, loadConfig } from "@lumenbazaar/shared";

import {
  handleSettlementConfirmation,
  markReconciliationDeadLetter,
  ReconciliationPendingError,
  type TransactionStatusClient
} from "./workers/settlementConfirmation.js";
import { handleStalePaymentCleanup } from "./workers/stalePaymentCleanup.js";

const databaseUrl = process.env.PAYMENT_PERSISTENCE_TEST_DATABASE_URL;
const describePostgres = databaseUrl === undefined ? describe.skip : describe;
const issuer = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describePostgres("settlement reconciliation", () => {
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "postgresql://integration-test-is-disabled" } }
  });
  const config = loadConfig({});

  beforeEach(async () => {
    await client.auditLog.deleteMany();
    await client.receipt.deleteMany();
    await client.settlement.deleteMany();
    await client.paymentAttempt.deleteMany();
  });

  afterAll(async () => {
    await client.$disconnect();
    await disconnectPrismaClient();
  });

  it("recovers a late confirmation and makes redelivery a no-op", async () => {
    const data = await seedTimedOutSettlement("late_confirmation");
    const states = [
      { status: "pending" as const, reason: "Not indexed yet." },
      { status: "confirmed" as const, ledger: 987654 }
    ];
    const statusClient: TransactionStatusClient = {
      async getTransactionState() {
        return states.shift() ?? { status: "confirmed", ledger: 987654 };
      }
    };
    const job = testJob(data);

    await expect(
      handleSettlementConfirmation(job, config, { db: client, statusClient })
    ).rejects.toBeInstanceOf(ReconciliationPendingError);
    await expect(
      client.settlement.findUniqueOrThrow({ where: { id: data.settlementId } })
    ).resolves.toMatchObject({
      reconciliationState: "pending",
      reconciliationAttempts: 1
    });

    await handleSettlementConfirmation(job, config, { db: client, statusClient });
    await handleSettlementConfirmation(job, config, { db: client, statusClient });

    await expect(
      client.settlement.findUniqueOrThrow({ where: { id: data.settlementId } })
    ).resolves.toMatchObject({
      status: "confirmed",
      ledger: 987654,
      reconciliationState: "reconciled",
      reconciliationAttempts: 2
    });
    await expect(
      client.paymentAttempt.findUniqueOrThrow({ where: { id: data.paymentAttemptId } })
    ).resolves.toMatchObject({ status: "confirmed" });
    await expect(
      client.receipt.count({ where: { paymentAttemptId: data.paymentAttemptId } })
    ).resolves.toBe(1);
  });

  it("records terminal chain failure for manual review", async () => {
    const data = await seedTimedOutSettlement("chain_failure");
    const statusClient: TransactionStatusClient = {
      async getTransactionState() {
        return { status: "failed", reason: "Transaction failed on chain." };
      }
    };

    await handleSettlementConfirmation(testJob(data), config, { db: client, statusClient });

    await expect(
      client.settlement.findUniqueOrThrow({ where: { id: data.settlementId } })
    ).resolves.toMatchObject({
      status: "failed",
      reconciliationState: "needs_review",
      reconciliationReason: "Transaction failed on chain."
    });
    await expect(
      client.auditLog.count({ where: { action: "settlement.reconciliation.needs_review" } })
    ).resolves.toBe(1);
  });

  it("marks exhausted retries for manual review without losing evidence", async () => {
    const data = await seedTimedOutSettlement("dead_letter");

    await markReconciliationDeadLetter(client, data, "Reconciliation retries exhausted.");

    await expect(
      client.settlement.findUniqueOrThrow({ where: { id: data.settlementId } })
    ).resolves.toMatchObject({
      reconciliationState: "needs_review",
      reconciliationReason: "Reconciliation retries exhausted."
    });
    await expect(
      client.paymentAttempt.findUniqueOrThrow({ where: { id: data.paymentAttemptId } })
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("does not resubmit a stale claim without transaction evidence", async () => {
    const attempt = await client.paymentAttempt.create({
      data: attemptData("missing_evidence", "settling")
    });
    const statusClient = {
      getTransactionState: vi.fn()
    } satisfies TransactionStatusClient;

    await handleSettlementConfirmation(
      testJob({ paymentAttemptId: attempt.id, network: attempt.network }),
      config,
      { db: client, statusClient }
    );

    expect(statusClient.getTransactionState).not.toHaveBeenCalled();
    await expect(
      client.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    ).resolves.toMatchObject({ status: "failed", failureCode: "SETTLEMENT_FAILED" });
  });

  it("retains failed payment, settlement, and receipt evidence during cleanup", async () => {
    const attempt = await client.paymentAttempt.create({
      data: {
        ...attemptData("retention", "failed"),
        createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      }
    });
    const settlement = await client.settlement.create({
      data: {
        correlationId: attempt.correlationId,
        paymentAttemptId: attempt.id,
        transactionHash: "tx_retention",
        network: attempt.network,
        amount: attempt.amount,
        assetCode: attempt.assetCode,
        assetIssuer: attempt.assetIssuer,
        status: "failed",
        reconciliationState: "needs_review"
      }
    });
    await client.receipt.create({
      data: {
        id: "receipt_retention",
        correlationId: attempt.correlationId,
        paymentAttemptId: attempt.id,
        transactionHash: settlement.transactionHash,
        network: attempt.network,
        amount: attempt.amount,
        assetCode: attempt.assetCode,
        assetIssuer: attempt.assetIssuer,
        status: "failed",
        failureCode: "SETTLEMENT_FAILED",
        evidenceHash: "retention_evidence_hash"
      }
    });

    await handleStalePaymentCleanup(
      testJob({ action: "cleanup_failed", maxAgeMs: 7 * 24 * 60 * 60 * 1000 }) as Job<{
        action: "cleanup_failed";
        maxAgeMs: number;
      }>,
      client
    );

    await expect(client.paymentAttempt.count({ where: { id: attempt.id } })).resolves.toBe(1);
    await expect(client.settlement.count({ where: { id: settlement.id } })).resolves.toBe(1);
    await expect(client.receipt.count({ where: { paymentAttemptId: attempt.id } })).resolves.toBe(
      1
    );
  });

  async function seedTimedOutSettlement(seed: string) {
    const attempt = await client.paymentAttempt.create({ data: attemptData(seed, "timed_out") });
    const settlement = await client.settlement.create({
      data: {
        correlationId: attempt.correlationId,
        paymentAttemptId: attempt.id,
        transactionHash: `tx_${seed}`,
        network: attempt.network,
        amount: attempt.amount,
        assetCode: attempt.assetCode,
        assetIssuer: attempt.assetIssuer,
        status: "timed_out",
        reconciliationState: "pending"
      }
    });
    return {
      paymentAttemptId: attempt.id,
      correlationId: attempt.correlationId,
      settlementId: settlement.id,
      transactionHash: settlement.transactionHash!,
      network: attempt.network
    };
  }
});

function attemptData(seed: string, status: string) {
  return {
    correlationId: `corr_${seed}`,
    paymentHash: `payment_hash_${seed}`,
    idempotencyKey: `verify:payment_hash_${seed}`,
    network: "stellar:testnet",
    assetCode: "USDC",
    assetIssuer: issuer,
    amount: "0.0500000",
    payTo: issuer,
    status,
    updatedAt: new Date()
  };
}

function testJob<T extends Record<string, unknown>>(data: T) {
  return {
    data,
    log: vi.fn(async () => 1)
  } as unknown as Job<T>;
}
