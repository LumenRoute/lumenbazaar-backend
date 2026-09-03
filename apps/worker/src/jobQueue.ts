import { type Queue } from "bullmq";

import { type AppConfig } from "@lumenbazaar/shared";

import { createBullMqQueue, queueNames } from "./queues.js";
import { type SettlementConfirmationJobData } from "./workers/settlementConfirmation.js";
import { type ResourceIndexingJobData } from "./workers/resourceIndexing.js";
import { type SearchSyncJobData } from "./workers/searchSync.js";

export type JobQueues = {
  settlementConfirmation: Queue;
  resourceIndexing: Queue;
  searchSync: Queue;
  conformanceRunner: Queue;
  networkHealth: Queue;
  receiptFinalizer: Queue;
  stalePaymentCleanup: Queue;
};

export function createJobQueues(config: AppConfig): JobQueues {
  return {
    settlementConfirmation: createBullMqQueue(queueNames.settlementConfirmation, config),
    resourceIndexing: createBullMqQueue(queueNames.resourceIndexing, config),
    searchSync: createBullMqQueue(queueNames.searchSync, config),
    conformanceRunner: createBullMqQueue(queueNames.conformanceRunner, config),
    networkHealth: createBullMqQueue(queueNames.networkHealth, config),
    receiptFinalizer: createBullMqQueue(queueNames.receiptFinalizer, config),
    stalePaymentCleanup: createBullMqQueue(queueNames.stalePaymentCleanup, config)
  };
}

export async function enqueueSettlementConfirmation(
  queue: Queue,
  data: SettlementConfirmationJobData,
  { delayMs = 5000, maxAttempts = 30 } = {}
) {
  return queue.add("settlement-confirmation", data, {
    attempts: maxAttempts,
    backoff: {
      type: "exponential",
      delay: delayMs
    },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function enqueueResourceIndexing(
  queue: Queue,
  data: ResourceIndexingJobData,
  { delayMs = 1000, maxAttempts = 5 } = {}
) {
  return queue.add("resource-indexing", data, {
    attempts: maxAttempts,
    backoff: {
      type: "exponential",
      delay: delayMs
    },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function enqueueSearchSync(
  queue: Queue,
  data: SearchSyncJobData,
  { delayMs = 1000, maxAttempts = 3 } = {}
) {
  return queue.add("search-sync", data, {
    attempts: maxAttempts,
    backoff: {
      type: "exponential",
      delay: delayMs
    },
    removeOnComplete: true,
    removeOnFail: false
  });
}
