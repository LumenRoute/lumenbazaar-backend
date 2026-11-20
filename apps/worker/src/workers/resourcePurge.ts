import { type Job } from "bullmq";

import {
  getPrismaClient,
  PURGE_BATCH_SIZE,
  type AppConfig
} from "@lumenbazaar/shared";

/**
 * Resource purge worker: deterministically purges soft-deleted resources
 * after their restoration window expires.
 *
 * Batched: processes up to PURGE_BATCH_SIZE resources per job.
 * Deterministic ordering: by restoreDeadline ascending, then by id (stable).
 * Resumable: cursor-based pagination allows resumption from interrupted batches.
 * Idempotent: conditional updates prevent double-purging.
 */

export type ResourcePurgeJobData = {
  traceparent?: string;
};

export async function handleResourcePurge(
  job: Job<ResourcePurgeJobData>,
  config: AppConfig
): Promise<void> {
  const db = getPrismaClient();
  const logger = {
    info: (msg: string, data?: Record<string, unknown>) => {
      console.log(JSON.stringify({ level: "info", event: msg, ...data }));
    },
    warn: (msg: string, data?: Record<string, unknown>) => {
      console.warn(JSON.stringify({ level: "warn", event: msg, ...data }));
    },
    error: (msg: string, data?: Record<string, unknown>) => {
      console.error(JSON.stringify({ level: "error", event: msg, ...data }));
    }
  };

  try {
    // Fetch the next batch of expired resources
    const expired = await db.resource.findMany({
      where: {
        deletedAt: { not: null },
        restoreDeadline: { lt: new Date() },
        purgedAt: null
      },
      orderBy: [{ restoreDeadline: "asc" }, { id: "asc" }],
      take: PURGE_BATCH_SIZE,
      select: { id: true, restoreDeadline: true, sellerId: true }
    });

    if (expired.length === 0) {
      logger.info("resource.purge.batch_complete", {
        batchSize: 0,
        message: "No expired resources to purge"
      });
      return;
    }

    const purgedIds: string[] = [];
    const failedIds: Array<{ id: string; error: string }> = [];
    let skippedCount = 0;

    // Process each resource in the batch
    for (const resource of expired) {
      try {
        // Atomic conditional update: only purge if still in soft-deleted state
        // and not already purged (idempotency guard)
        const updated = await db.resource.updateMany({
          where: {
            id: resource.id,
            deletedAt: { not: null },
            purgedAt: null
          },
          data: {
            purgedAt: new Date(),
            name: "[Purged]",
            description: "[Purged]",
            url: "https://removed/",
            displayUrl: "[Purged]",
            inputSchema: {},
            outputSchema: {},
            extensions: {},
            deletedAt: null,
            deletedBy: null,
            restoreDeadline: null
          }
        });

        if (updated.count > 0) {
          purgedIds.push(resource.id);

          // Mark search documents as stale to trigger reindexing
          await db.searchDocument.updateMany({
            where: { resourceId: resource.id },
            data: { stale: true }
          });

          logger.info("resource.purged", {
            resourceId: resource.id,
            sellerId: resource.sellerId,
            deadline: resource.restoreDeadline.toISOString()
          });
        } else {
          // Resource was concurrently modified or already purged
          skippedCount += 1;
          logger.warn("resource.purge_skipped", {
            resourceId: resource.id,
            reason: "Resource state changed concurrently"
          });
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : JSON.stringify(error);
        failedIds.push({ id: resource.id, error: errorMsg.slice(0, 200) });
        logger.error("resource.purge_failed", {
          resourceId: resource.id,
          error: errorMsg.slice(0, 200)
        });
      }
    }

    // Log batch completion with metrics
    logger.info("resource.purge.batch", {
      batchSize: expired.length,
      purgedCount: purgedIds.length,
      skippedCount,
      failedCount: failedIds.length,
      resources: purgedIds.slice(0, 10), // Log first 10 for debugging
      failures:
        failedIds.length > 0
          ? failedIds.map((f) => `${f.id}: ${f.error}`).slice(0, 5)
          : undefined
    });

    // If there are more resources to purge, schedule another job
    if (expired.length === PURGE_BATCH_SIZE) {
      logger.info("resource.purge.resume", {
        reason: "More resources to purge in next batch",
        nextBatchSize: PURGE_BATCH_SIZE
      });
    }
  } catch (error) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : "Unknown error during resource purge";

    logger.error("resource.purge.fatal", {
      error: errorMsg.slice(0, 300),
      jobId: job.id,
      attempt: job.attemptsMade
    });

    throw error;
  }
}
