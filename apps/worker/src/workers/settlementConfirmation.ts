import { createHash, randomUUID } from "node:crypto";

import { type PrismaClient } from "@prisma/client";
import * as StellarSdk from "@stellar/stellar-sdk";
import { type Job } from "bullmq";

import { type AppConfig, getPrismaClient } from "@lumenbazaar/shared";
import { createHorizonClient } from "@lumenbazaar/stellar-payments";

export type SettlementConfirmationJobData = {
  paymentAttemptId: string;
  settlementId?: string;
  transactionHash?: string;
  network: string;
};

export type ChainTransactionState =
  | { status: "confirmed"; ledger: number }
  | { status: "failed"; reason: string }
  | { status: "pending"; reason: string };

export type TransactionStatusClient = {
  getTransactionState: (transactionHash: string, network: string) => Promise<ChainTransactionState>;
};

export class ReconciliationPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationPendingError";
  }
}

export async function handleSettlementConfirmation(
  job: Job<SettlementConfirmationJobData>,
  config: AppConfig,
  dependencies: {
    db?: PrismaClient;
    statusClient?: TransactionStatusClient;
  } = {}
) {
  const db = dependencies.db ?? getPrismaClient();
  const statusClient = dependencies.statusClient ?? createTransactionStatusClient(config);
  const attempt = await db.paymentAttempt.findUnique({
    where: { id: job.data.paymentAttemptId },
    include: { settlement: true, receipt: true }
  });
  if (attempt === null) {
    throw new Error(`Payment attempt not found: ${job.data.paymentAttemptId}`);
  }
  const settlement = attempt.settlement;
  if (settlement?.status === "confirmed" && attempt.receipt?.status === "finalized") {
    await job.log(`Settlement ${settlement.id} is already final.`);
    return;
  }

  const transactionHash = settlement?.transactionHash ?? job.data.transactionHash;
  if (settlement === null || transactionHash === null || transactionHash === undefined) {
    const reason = "No submitted transaction evidence is available; manual review is required.";
    await db.$transaction([
      db.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "failed",
          failureCode: "SETTLEMENT_FAILED",
          failureReason: reason
        }
      }),
      db.auditLog.create({
        data: {
          actorType: "system",
          action: "settlement.reconciliation.needs_review",
          targetType: "payment_attempt",
          targetId: attempt.id,
          metadata: { reason: "missing_transaction_evidence" }
        }
      })
    ]);
    await job.log(reason);
    return;
  }

  const state = await statusClient.getTransactionState(transactionHash, settlement.network);
  if (state.status === "pending") {
    await db.settlement.update({
      where: { id: settlement.id },
      data: {
        reconciliationState: "pending",
        reconciliationReason: state.reason,
        reconciliationAttempts: { increment: 1 },
        lastReconciledAt: new Date()
      }
    });
    throw new ReconciliationPendingError(state.reason);
  }
  if (state.status === "failed") {
    await recordNeedsReview(db, attempt.id, settlement.id, state.reason);
    await job.log(`Settlement ${settlement.id} requires manual review: ${state.reason}`);
    return;
  }

  const settledAt = new Date();
  const evidenceHash = createHash("sha256")
    .update(
      [
        attempt.id,
        attempt.paymentHash,
        transactionHash,
        String(state.ledger),
        settlement.network,
        settlement.amount.toString(),
        settlement.assetIssuer
      ].join(":"),
      "utf8"
    )
    .digest("hex");
  await db.$transaction(async (tx) => {
    await tx.settlement.update({
      where: { id: settlement.id },
      data: {
        status: "confirmed",
        ledger: state.ledger,
        settledAt,
        reconciliationState: "reconciled",
        reconciliationReason: null,
        reconciliationAttempts: { increment: 1 },
        lastReconciledAt: settledAt
      }
    });
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "confirmed", failureCode: null, failureReason: null }
    });
    await tx.receipt.upsert({
      where: { paymentAttemptId: attempt.id },
      create: {
        id: `receipt_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        paymentAttemptId: attempt.id,
        resourceId: attempt.resourceId,
        sellerId: attempt.sellerId,
        transactionHash,
        ledger: state.ledger,
        network: attempt.network,
        amount: attempt.amount,
        assetCode: attempt.assetCode,
        assetIssuer: attempt.assetIssuer,
        status: "finalized",
        settledAt,
        failureCode: null,
        failureReason: null,
        evidenceHash
      },
      update: {
        transactionHash,
        ledger: state.ledger,
        status: "finalized",
        settledAt,
        failureCode: null,
        failureReason: null,
        evidenceHash
      }
    });
    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: "settlement.reconciliation.confirmed",
        targetType: "settlement",
        targetId: settlement.id,
        metadata: {
          ledger: state.ledger,
          network: settlement.network,
          paymentAttemptId: attempt.id,
          transactionHash
        }
      }
    });
  });
  await job.log(`Settlement ${settlement.id} reconciled in ledger ${state.ledger}.`);
}

export async function markReconciliationDeadLetter(
  db: PrismaClient,
  data: SettlementConfirmationJobData,
  reason: string
) {
  if (data.settlementId !== undefined) {
    await recordNeedsReview(db, data.paymentAttemptId, data.settlementId, reason);
    return;
  }
  await db.paymentAttempt.updateMany({
    where: { id: data.paymentAttemptId, status: "settling" },
    data: { status: "failed", failureCode: "SETTLEMENT_FAILED", failureReason: reason }
  });
}

function createTransactionStatusClient(config: AppConfig): TransactionStatusClient {
  return {
    async getTransactionState(transactionHash, network) {
      const horizonRef = createHorizonClient(config, network);
      const server = new StellarSdk.Horizon.Server(horizonRef.url, {
        allowHttp: horizonRef.url.startsWith("http://")
      });
      try {
        const transaction = await server.transactions().transaction(transactionHash).call();
        if (transaction.successful === false) {
          return { status: "failed", reason: "Stellar recorded the transaction as failed." };
        }
        return { status: "confirmed", ledger: transaction.ledger_attr };
      } catch (error) {
        if (isNotFound(error)) {
          return { status: "pending", reason: "Transaction is not yet visible on Horizon." };
        }
        throw error;
      }
    }
  };
}

async function recordNeedsReview(
  db: PrismaClient,
  paymentAttemptId: string,
  settlementId: string,
  reason: string
) {
  await db.$transaction([
    db.settlement.update({
      where: { id: settlementId },
      data: {
        status: "failed",
        reconciliationState: "needs_review",
        reconciliationReason: reason,
        reconciliationAttempts: { increment: 1 },
        lastReconciledAt: new Date()
      }
    }),
    db.paymentAttempt.update({
      where: { id: paymentAttemptId },
      data: { status: "failed", failureCode: "SETTLEMENT_FAILED", failureReason: reason }
    }),
    db.auditLog.create({
      data: {
        actorType: "system",
        action: "settlement.reconciliation.needs_review",
        targetType: "settlement",
        targetId: settlementId,
        metadata: { paymentAttemptId, reason }
      }
    })
  ]);
}

function isNotFound(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { response?: { status?: number }; status?: number };
  return candidate.status === 404 || candidate.response?.status === 404;
}
