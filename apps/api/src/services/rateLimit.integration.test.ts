import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RateLimitService, RedisRateLimitCounterStore } from "./rateLimit.js";

const redisUrl = process.env.RATE_LIMIT_TEST_REDIS_URL;
const describeRedis = redisUrl === undefined ? describe.skip : describe;

describeRedis("Redis rate limiting", () => {
  const clients: Redis[] = [];

  beforeEach(async () => {
    const cleanup = new Redis(redisUrl ?? "redis://integration-test-is-disabled");
    clients.push(cleanup);
    const keys = await cleanup.keys("lumenbazaar:rate-limit:*");
    if (keys.length > 0) {
      await cleanup.del(...keys);
    }
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map(async (client) => client.quit()));
  });

  it("enforces one limit across independent API process clients", async () => {
    const services = [createService(), createService(), createService()];
    const request = {
      key: "multi-replica-client",
      route: "POST /v1/settle",
      scope: "facilitator" as const
    };

    const results = await Promise.all(services.map(async (service) => service.consume(request)));

    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.filter((result) => !result.allowed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.resetAt.getTime())).size).toBeLessThanOrEqual(2);
  });

  function createService() {
    const client = new Redis(redisUrl ?? "redis://integration-test-is-disabled");
    clients.push(client);
    return new RateLimitService({
      counterStore: new RedisRateLimitCounterStore(client),
      rules: { facilitator: { limit: 2, windowMs: 60_000 } }
    });
  }
});
