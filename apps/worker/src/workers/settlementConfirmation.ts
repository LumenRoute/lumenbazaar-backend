import { type Job } from "bullmq";

import { type AppConfig, getPrismaClient } from "@lumenbazaar/shared";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createHorizonClient } from "@lumenbazaar/stellar-payments";

export type SettlementConfirmationJobData = {
  settlementId: string;
  transactionHash: string;
  network: string;
  paymentAttemptId: string;
};

/**
 * Settlement Confirmation Worker
 * Polls Stellar Horizon for transaction confirmation status and updates settlement records
 */
export async function handleSettlementConfirmation(
  job: Job<SettlementConfirmationJobData>,
  config: AppConfig
) {
  const { settlementId, transactionHash, network, paymentAttemptId } = job.data;

  try {
    const db = getPrismaClient();

    // Get current settlement status
    const settlement = await db.settlement.findUnique({
      where: { id: settlementId },
      include: {
        paymentAttempt: true
      }
    });

    if (!settlement) {
      throw new Error(`Settlement not found: ${settlementId}`);
    }

    // If already confirmed, skip
    if (settlement.status === "confirmed" || settlement.status === "finalized") {
      job.log(`Settlement ${settlementId} already confirmed`);
      return;
    }

    // Query Horizon for transaction status
    const horizonRef = createHorizonClient(config, network);
    const horizonClient = new StellarSdk.Horizon.Server(horizonRef.url, { allowHttp: false });

    let confirmedLedger: number | null = null;
    let confirmationError: string | null = null;

    try {
      const tx = await horizonClient.transactions().transaction(transactionHash).call();

      if (tx) {
        confirmedLedger = tx.ledger_attr || null;
        job.log(
          `Transaction ${transactionHash} confirmed in ledger ${confirmedLedger} on network ${network}`
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Transaction not yet found or failed
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        job.log(`Transaction ${transactionHash} not yet confirmed, will retry`);
        // Retry with exponential backoff
        throw err;
      }

      confirmationError = errorMsg;
      job.log(`Error querying transaction status: ${confirmationError}`);
    }

    // Update settlement with confirmation status
    if (confirmedLedger !== null) {
      await db.settlement.update({
        where: { id: settlementId },
        data: {
          status: "confirmed",
          ledger: confirmedLedger
        }
      });

      // Update payment attempt status
      await db.paymentAttempt.update({
        where: { id: paymentAttemptId },
        data: {
          status: "confirmed"
        }
      });

      // Update receipt status to finalized
      await db.receipt.update({
        where: { paymentAttemptId },
        data: {
          status: "finalized",
          ledger: confirmedLedger,
          settledAt: new Date()
        }
      });

      job.log(`Settlement ${settlementId} confirmed and receipt finalized`);
    } else if (confirmationError) {
      // Mark as failed if there was an error
      await db.settlement.update({
        where: { id: settlementId },
        data: {
          status: "failed"
        }
      });

      await db.paymentAttempt.update({
        where: { id: paymentAttemptId },
        data: {
          status: "failed",
          failureCode: "SETTLEMENT_CONFIRMATION_FAILED",
          failureReason: confirmationError
        }
      });

      await db.receipt.update({
        where: { paymentAttemptId },
        data: {
          status: "failed",
          failureCode: "SETTLEMENT_CONFIRMATION_FAILED",
          failureReason: confirmationError
        }
      });

      job.log(`Settlement ${settlementId} confirmation failed: ${confirmationError}`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    job.log(`Settlement confirmation job failed: ${errorMsg}`);

    // Re-throw to trigger retry
    throw err;
  }
}
