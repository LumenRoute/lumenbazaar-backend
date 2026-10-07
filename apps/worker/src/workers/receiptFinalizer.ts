import { type Job } from "bullmq";

import { getPrismaClient, redactSensitiveText } from "@lumenbazaar/shared";

export type ReceiptFinalizerJobData = {
  action: "finalize_pending" | "finalize_by_settlement" | "retry_failed";
  settlementId?: string;
  maxAge?: number;
};

/**
 * Receipt Finalizer Worker
 * Finalizes receipts based on settlement and payment confirmation status
 */
export async function handleReceiptFinalizer(job: Job<ReceiptFinalizerJobData>) {
  const { action, settlementId, maxAge = 3600000 } = job.data; // Default 1 hour

  try {
    const db = getPrismaClient();

    if (action === "finalize_pending") {
      job.log("Processing pending receipts");

      // Find all pending receipts with confirmed settlements
      const receipts = await db.receipt.findMany({
        where: {
          status: "pending"
        },
        include: {
          paymentAttempt: {
            include: {
              settlement: true
            }
          }
        },
        take: 100
      });

      let finalizedCount = 0;
      for (const receipt of receipts) {
        try {
          const settlement = receipt.paymentAttempt?.settlement;

          // If settlement is confirmed, finalize the receipt
          if (settlement && settlement.status === "confirmed") {
            await db.receipt.update({
              where: { id: receipt.id },
              data: {
                status: "finalized",
                ledger: settlement.ledger,
                settledAt: settlement.settledAt
              }
            });

            finalizedCount++;
            job.log(`Finalized receipt ${receipt.id} from settlement ${settlement.id}`);
          }
        } catch (err) {
          const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
          job.log(`Failed to finalize receipt ${receipt.id}: ${errorMsg}`);
        }
      }

      job.log(`Finalized ${finalizedCount} receipts`);
    } else if (action === "finalize_by_settlement") {
      job.log(`Finalizing receipts for settlement ${settlementId}`);

      // Find settlement and its associated receipt
      if (settlementId) {
        const settlement = await db.settlement.findUnique({
          where: { id: settlementId }
        });

        if (!settlement) {
          throw new Error(`Settlement not found: ${settlementId}`);
        }

        // Update receipt status if settlement is confirmed
        if (settlement.status === "confirmed") {
          const receipt = await db.receipt.findUnique({
            where: { paymentAttemptId: settlement.paymentAttemptId }
          });

          if (receipt && receipt.status !== "finalized") {
            await db.receipt.update({
              where: { id: receipt.id },
              data: {
                status: "finalized",
                ledger: settlement.ledger,
                settledAt: settlement.settledAt
              }
            });

            job.log(`Finalized receipt ${receipt.id}`);
          }
        }
      }
    } else if (action === "retry_failed") {
      job.log("Retrying failed receipts");

      // Find failed receipts that might now be resolved
      const failedReceipts = await db.receipt.findMany({
        where: {
          status: "failed"
        },
        include: {
          paymentAttempt: {
            include: {
              settlement: true
            }
          }
        },
        take: 50
      });

      let retriedCount = 0;
      const now = new Date().getTime();

      for (const receipt of failedReceipts) {
        try {
          // Only retry if created within maxAge
          const receiptAge = now - new Date(receipt.createdAt).getTime();
          if (receiptAge > maxAge) {
            job.log(`Receipt ${receipt.id} too old to retry, skipping`);
            continue;
          }

          const settlement = receipt.paymentAttempt?.settlement;

          // If settlement is now confirmed, update receipt status
          if (settlement && settlement.status === "confirmed") {
            await db.receipt.update({
              where: { id: receipt.id },
              data: {
                status: "finalized",
                ledger: settlement.ledger,
                settledAt: settlement.settledAt,
                failureCode: null,
                failureReason: null
              }
            });

            retriedCount++;
            job.log(`Recovered receipt ${receipt.id} from settlement ${settlement.id}`);
          }
        } catch (err) {
          const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
          job.log(`Failed to retry receipt ${receipt.id}: ${errorMsg}`);
        }
      }

      job.log(`Retried ${retriedCount} failed receipts`);
    }
  } catch (err) {
    const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
    job.log(`Receipt finalizer job failed: ${errorMsg}`);
    throw err;
  }
}
