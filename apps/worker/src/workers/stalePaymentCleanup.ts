import { type Job } from "bullmq";

import { getPrismaClient } from "@lumenbazaar/shared";

export type StalePaymentCleanupJobData = {
  action: "cleanup_expired" | "cleanup_failed" | "archive";
  maxAgeMs?: number; // How long to keep records (default 7 days)
};

/**
 * Stale Payment Cleanup Worker
 * Cleans up old, expired, and failed payment records
 */
export async function handleStalePaymentCleanup(job: Job<StalePaymentCleanupJobData>) {
  const { action, maxAgeMs = 7 * 24 * 60 * 60 * 1000 } = job.data; // Default 7 days

  try {
    const db = getPrismaClient();
    const cutoffDate = new Date(Date.now() - maxAgeMs);

    if (action === "cleanup_expired") {
      job.log("Cleaning up expired payment attempts");

      // Find payment attempts that are older than maxAge and not settled
      const expiredAttempts = await db.paymentAttempt.findMany({
        where: {
          status: "received",
          createdAt: { lt: cutoffDate }
        },
        take: 1000
      });

      let expiredCount = 0;
      for (const attempt of expiredAttempts) {
        try {
          // Mark as expired
          await db.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: "expired",
              failureCode: "PAYMENT_EXPIRED",
              failureReason: `Payment expired after ${maxAgeMs}ms`
            }
          });

          expiredCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          job.log(`Failed to expire payment ${attempt.id}: ${errorMsg}`);
        }
      }

      job.log(`Marked ${expiredCount} payments as expired`);
    } else if (action === "cleanup_failed") {
      job.log("Cleaning up failed payment records");

      // Find old failed payments and their associated records
      const failedAttempts = await db.paymentAttempt.findMany({
        where: {
          status: "failed",
          createdAt: { lt: cutoffDate }
        },
        take: 1000
      });

      let deletedCount = 0;
      for (const attempt of failedAttempts) {
        try {
          // Delete associated settlement records
          await db.settlement.deleteMany({
            where: { paymentAttemptId: attempt.id }
          });

          // Delete associated receipt records
          await db.receipt.deleteMany({
            where: { paymentAttemptId: attempt.id }
          });

          // Delete the payment attempt
          await db.paymentAttempt.delete({
            where: { id: attempt.id }
          });

          deletedCount++;
          job.log(`Deleted failed payment ${attempt.id}`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          job.log(`Failed to delete payment ${attempt.id}: ${errorMsg}`);
        }
      }

      job.log(`Deleted ${deletedCount} failed payment records`);
    } else if (action === "archive") {
      job.log("Archiving old settled payments for reporting");

      // Find old settled payments (keep but mark as archived in metadata)
      const settledAttempts = await db.paymentAttempt.findMany({
        where: {
          status: {
            in: ["settled", "confirmed"]
          },
          createdAt: { lt: cutoffDate }
        },
        take: 1000,
        include: {
          settlement: true,
          receipt: true
        }
      });

      let archivedCount = 0;
      for (const attempt of settledAttempts) {
        try {
          // Record archival in catalog event for audit trail
          await db.catalogEvent.create({
            data: {
              type: "payment_archived",
              status: "success",
              reason: "Archival of old payment record",
              metadata: {
                paymentAttemptId: attempt.id,
                status: attempt.status,
                settledAt: attempt.settlement?.settledAt,
                createdAt: attempt.createdAt.toISOString()
              }
            }
          });

          archivedCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          job.log(`Failed to archive payment ${attempt.id}: ${errorMsg}`);
        }
      }

      job.log(`Archived ${archivedCount} settled payment records`);
    }

    // Clean up old catalog events
    const oldCatalogEvents = await db.catalogEvent.findMany({
      where: {
        createdAt: { lt: cutoffDate }
      },
      take: 1000
    });

    let cleanedEventsCount = 0;
    for (const event of oldCatalogEvents) {
      try {
        await db.catalogEvent.delete({
          where: { id: event.id }
        });
        cleanedEventsCount++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        job.log(`Failed to delete catalog event ${event.id}: ${errorMsg}`);
      }
    }

    job.log(`Cleaned up ${cleanedEventsCount} old catalog events`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    job.log(`Stale payment cleanup job failed: ${errorMsg}`);
    throw err;
  }
}
