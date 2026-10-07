import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";
import {
  createRuntimePaymentReconciliation,
  settlementReconciliationJobId
} from "@lumenbazaar/stellar-payments";

import { enqueueSettlementConfirmation } from "./jobQueue.js";
import { createBullMqQueue, queueNames } from "./queues.js";

const redisUrl = process.env.WORKER_TEST_REDIS_URL;
const describeRedis = redisUrl === undefined ? describe.skip : describe;

describeRedis("durable settlement jobs", () => {
  const queues: ReturnType<typeof createBullMqQueue>[] = [];
  const config = loadConfig({ REDIS_URL: redisUrl ?? "redis://integration-test-is-disabled" });

  afterEach(async () => {
    const activeQueues = queues.splice(0);
    const cleanupQueue = activeQueues[0];
    if (cleanupQueue !== undefined) {
      await cleanupQueue.pause();
      await cleanupQueue.obliterate({ force: true });
    }
    await Promise.all(activeQueues.map(async (queue) => queue.close()));
  });

  it("keeps one deterministic job across queue clients and restart", async () => {
    const firstQueue = createBullMqQueue(queueNames.settlementConfirmation, config);
    const secondQueue = createBullMqQueue(queueNames.settlementConfirmation, config);
    queues.push(firstQueue, secondQueue);
    const data = {
      paymentAttemptId: "attempt_queue_restart",
      settlementId: "settlement_queue_restart",
      transactionHash: "tx_queue_restart",
      network: "stellar:testnet"
    };

    const [first, duplicate] = await Promise.all([
      enqueueSettlementConfirmation(firstQueue, data),
      enqueueSettlementConfirmation(secondQueue, data)
    ]);

    expect(duplicate.id).toBe(first.id);
    await firstQueue.close();
    queues.splice(queues.indexOf(firstQueue), 1);
    const restartedQueue = createBullMqQueue(queueNames.settlementConfirmation, config);
    queues.push(restartedQueue);
    await expect(restartedQueue.getJob(first.id!)).resolves.toMatchObject({ id: first.id });
    await expect(restartedQueue.getJobCounts("delayed", "waiting")).resolves.toMatchObject({
      delayed: 1,
      waiting: 0
    });
  });

  it("persists an API-scheduled reconciliation job", async () => {
    const runtime = createRuntimePaymentReconciliation(config, { forceHosted: true });
    const reader = createBullMqQueue(queueNames.settlementConfirmation, config);
    queues.push(reader);
    const paymentAttemptId = "attempt_api_scheduler";

    await runtime.scheduler!.enqueue({
      correlationId: "corr_api_scheduler",
      paymentAttemptId,
      settlementId: "settlement_api_scheduler",
      transactionHash: "tx_api_scheduler",
      network: "stellar:testnet"
    });
    await runtime.close();

    await expect(
      reader.getJob(settlementReconciliationJobId(paymentAttemptId))
    ).resolves.toMatchObject({
      data: {
        correlationId: "corr_api_scheduler",
        paymentAttemptId,
        settlementId: "settlement_api_scheduler",
        transactionHash: "tx_api_scheduler"
      }
    });
  });
});
