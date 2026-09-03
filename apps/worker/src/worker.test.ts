import { describe, expect, it } from "vitest";

import { createWorkerApp, InMemoryWorkerBackend } from "./worker.js";
import { defaultJobOptions, queueNames } from "./queues.js";

describe("worker foundation", () => {
  it("configures queue names and retry policies", () => {
    expect(queueNames.resourceIndexing).toBe("resource-indexing");
    expect(queueNames.deadLetter).toBe("dead-letter");
    expect(defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000
      },
      removeOnFail: false
    });
  });

  it("processes a local test job through the worker lifecycle", async () => {
    const backend = new InMemoryWorkerBackend();
    const app = createWorkerApp({ backend });

    await app.start();
    await app.enqueueTestJob();

    expect(app.processedJobs()).toEqual([
      {
        id: "job_test",
        name: "worker.health-check",
        queueName: "resource-indexing",
        data: {
          ok: true
        }
      }
    ]);
    await app.stop();
  });
});
