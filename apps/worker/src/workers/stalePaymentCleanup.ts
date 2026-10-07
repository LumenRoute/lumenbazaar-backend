import { type Job } from "bullmq";

import { type PrismaClient } from "@prisma/client";

import { getPrismaClient, redactSensitiveText } from "@lumenbazaar/shared";

export type StalePaymentCleanupJobData = {
  action: "cleanup_expired" | "cleanup_failed" | "archive";
  maxAgeMs?: number; // How long to keep records (default 7 days)
};

/**
 * Stale Payment Cleanup Worker
 * Cleans up old, expired, and failed payment records
 */
export async function handleStalePaymentCleanup(
  job: Job<StalePaymentCleanupJobData>,
  db: PrismaClient = getPrismaClient()
) {
  const { action, maxAgeMs = 7 * 24 * 60 * 60 * 1000 } = job.data; // Default 7 days

  try {
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
              failureCode: "AUTH_EXPIRED",
              failureReason: `Payment expired after ${maxAgeMs}ms`
            }
          });

          expiredCount++;
        } catch (err) {
          const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
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

      let retainedCount = 0;
      for (const attempt of failedAttempts) {
        try {
          await db.auditLog.create({
            data: {
              actorType: "system",
              action: "payment.retention.reviewed",
              targetType: "payment_attempt",
              targetId: attempt.id,
              metadata: {
                retained: true,
                reason: "financial_evidence",
                status: attempt.status
              }
            }
          });
          retainedCount++;
          job.log(`Retained failed payment evidence ${attempt.id}`);
        } catch (err) {
          const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
          job.log(`Failed to record retention review for ${attempt.id}: ${errorMsg}`);
        }
      }

      job.log(`Retained ${retainedCount} failed payment records`);
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
          const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
          job.log(`Failed to archive payment ${attempt.id}: ${errorMsg}`);
        }
      }

      job.log(`Archived ${archivedCount} settled payment records`);
    }

    job.log("Financial and audit evidence retention rules applied");
  } catch (err) {
    const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
    job.log(`Stale payment cleanup job failed: ${errorMsg}`);
    throw err;
  }
}
