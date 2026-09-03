import { type Job, Worker } from "bullmq";

import { type AppConfig, loadConfig } from "@lumenbazaar/shared";

import { createBullMqConnection, queueNames, type QueueName } from "./queues.js";

export type WorkerJob = {
  id: string;
  name: string;
  queueName: QueueName;
  data: Record<string, unknown>;
};

export type WorkerBackend = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  enqueue: (job: WorkerJob) => Promise<void>;
  processedJobs: () => WorkerJob[];
};

export class InMemoryWorkerBackend implements WorkerBackend {
  private readonly jobs: WorkerJob[] = [];
  private readonly processed: WorkerJob[] = [];
  private running = false;

  async start() {
    this.running = true;
    await this.drain();
  }

  async stop() {
    this.running = false;
  }

  async enqueue(job: WorkerJob) {
    this.jobs.push(job);
    await this.drain();
  }

  processedJobs() {
    return [...this.processed];
  }

  private async drain() {
    if (!this.running) {
      return;
    }

    while (this.jobs.length > 0) {
      const job = this.jobs.shift();

      if (job !== undefined) {
        this.processed.push(job);
      }
    }
  }
}

export class BullMqWorkerBackend implements WorkerBackend {
  private readonly connection;
  private readonly workers: Worker[] = [];
  private readonly processed: WorkerJob[] = [];

  constructor(private readonly config: AppConfig) {
    this.connection = createBullMqConnection(config);
  }

  async start() {
    this.workers.push(
      new Worker(
        queueNames.resourceIndexing,
        async (job: Job<Record<string, unknown>>) => {
          this.processed.push({
            id: String(job.id),
            name: job.name,
            queueName: queueNames.resourceIndexing,
            data: job.data
          });
        },
        {
          connection: this.connection
        }
      )
    );
  }

  async stop() {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.connection.quit();
  }

  async enqueue(_job: WorkerJob) {
    throw new Error("Use BullMQ Queue instances to enqueue jobs for BullMqWorkerBackend.");
  }

  processedJobs() {
    return [...this.processed];
  }
}

export type WorkerAppOptions = {
  config?: AppConfig;
  backend?: WorkerBackend;
};

export function createWorkerApp(options: WorkerAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const backend = options.backend ?? new InMemoryWorkerBackend();
  let shutdownRegistered = false;

  return {
    config,
    queueNames,
    async start() {
      await backend.start();
      registerGracefulShutdownOnce(async () => {
        await backend.stop();
      }, shutdownRegistered);
      shutdownRegistered = true;
    },
    async stop() {
      await backend.stop();
    },
    async enqueueTestJob() {
      await backend.enqueue({
        id: "job_test",
        name: "worker.health-check",
        queueName: queueNames.resourceIndexing,
        data: {
          ok: true
        }
      });
    },
    processedJobs() {
      return backend.processedJobs();
    }
  };
}

function registerGracefulShutdownOnce(handler: () => Promise<void>, alreadyRegistered: boolean) {
  if (alreadyRegistered) {
    return;
  }

  const shutdown = async () => {
    await handler();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
