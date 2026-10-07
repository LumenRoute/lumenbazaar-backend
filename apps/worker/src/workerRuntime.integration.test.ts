import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";

import { BullMqWorkerBackend } from "./worker.js";

const databaseUrl = process.env.PAYMENT_PERSISTENCE_TEST_DATABASE_URL;
const redisUrl = process.env.WORKER_TEST_REDIS_URL;
const describeRuntime =
  databaseUrl === undefined || redisUrl === undefined ? describe.skip : describe;

describeRuntime("hosted worker runtime", () => {
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "postgresql://integration-test-is-disabled" } }
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("starts and stops BullMQ against real PostgreSQL and Redis", async () => {
    process.env.DATABASE_URL = databaseUrl;
    await client.receipt.deleteMany();
    await client.settlement.deleteMany();
    await client.paymentAttempt.deleteMany();
    const backend = new BullMqWorkerBackend(
      loadConfig({ REDIS_URL: redisUrl ?? "redis://integration-test-is-disabled" })
    );

    await expect(backend.start()).resolves.toBeUndefined();
    await expect(backend.stop()).resolves.toBeUndefined();
  });
});
