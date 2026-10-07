import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { type AppConfig } from "@lumenbazaar/shared";

import { knownQueues, type MetricsService } from "./metrics.js";

export type OperationalMetricsRefresher = {
  close: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function createOperationalMetricsRefresher(
  config: AppConfig,
  metrics: MetricsService
): OperationalMetricsRefresher {
  if (
    process.env.VITEST !== undefined ||
    process.env.NODE_ENV === "test" ||
    config.nodeEnv !== "production" ||
    config.lumenEnv === "local"
  ) {
    return { close: async () => undefined, refresh: async () => undefined };
  }

  const db = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  const redis = new Redis(config.redisUrl, {
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: null
  });
  const queues = knownQueues.map((name) => new Queue(name, { connection: redis }));

  return {
    async refresh() {
      try {
        const threshold = new Date(Date.now() - 5 * 60_000);
        const [stuck, review] = await Promise.all([
          db.settlement.groupBy({
            by: ["network"],
            where: { reconciliationState: "pending", createdAt: { lt: threshold } },
            _count: { _all: true }
          }),
          db.settlement.groupBy({
            by: ["network"],
            where: { reconciliationState: "needs_review" },
            _count: { _all: true }
          })
        ]);
        for (const network of ["stellar:testnet", "stellar:pubnet"]) {
          metrics.setStuckSettlements(
            network,
            stuck.find((row) => row.network === network)?._count._all ?? 0
          );
          metrics.setReconciliationBacklog(
            network,
            review.find((row) => row.network === network)?._count._all ?? 0
          );
        }
        metrics.setDependencyStatus("postgres", true);
      } catch {
        metrics.setDependencyStatus("postgres", false);
      }

      try {
        if (redis.status === "wait") await redis.connect();
        await Promise.all(
          queues.map(async (queue) => {
            const counts = await queue.getJobCounts("active", "delayed", "waiting");
            metrics.setQueueDepth(
              queue.name,
              (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.waiting ?? 0)
            );
          })
        );
        metrics.setDependencyStatus("redis", true);
      } catch {
        metrics.setDependencyStatus("redis", false);
      }
    },
    async close() {
      await Promise.all(queues.map((queue) => queue.close()));
      if (redis.status !== "end") redis.disconnect();
      await db.$disconnect();
    }
  };
}
