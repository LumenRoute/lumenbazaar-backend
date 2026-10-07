import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { type AppConfig, type NetworkId } from "@lumenbazaar/shared";

export const settlementReconciliationQueueName = "settlement-confirmation";

export type SettlementReconciliationJob = {
  correlationId: string;
  paymentAttemptId: string;
  settlementId: string;
  transactionHash: string;
  network: NetworkId;
};

export type PaymentReconciliationScheduler = {
  enqueue: (job: SettlementReconciliationJob) => Promise<void>;
};

export function settlementReconciliationJobId(paymentAttemptId: string) {
  return `settlement-${paymentAttemptId.replaceAll(":", "-")}`;
}

export function createRuntimePaymentReconciliation(
  config: AppConfig,
  options: { forceHosted?: boolean } = {}
) {
  if (
    options.forceHosted !== true &&
    (process.env.VITEST !== undefined ||
      process.env.NODE_ENV === "test" ||
      config.nodeEnv !== "production" ||
      config.lumenEnv === "local")
  ) {
    return { scheduler: undefined, close: async () => undefined };
  }

  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<SettlementReconciliationJob>(settlementReconciliationQueueName, {
    connection
  });
  return {
    scheduler: {
      async enqueue(job: SettlementReconciliationJob) {
        await queue.add("settlement-confirmation", job, {
          jobId: settlementReconciliationJobId(job.paymentAttemptId),
          delay: 5000,
          attempts: 8,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: false
        });
      }
    } satisfies PaymentReconciliationScheduler,
    close: async () => {
      await queue.close();
      await connection.quit();
    }
  };
}
