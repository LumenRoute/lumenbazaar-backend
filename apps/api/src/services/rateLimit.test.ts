import { describe, expect, it } from "vitest";

import { RateLimitService } from "./rateLimit.js";

describe("RateLimitService", () => {
  it("allows requests inside a window and records blocked events with hashed keys", async () => {
    const service = new RateLimitService({
      rules: {
        facilitator: {
          limit: 1,
          windowMs: 60_000
        }
      }
    });

    await expect(
      service.consume({
        key: "client-secret-api-key",
        route: "POST /v1/verify",
        scope: "facilitator"
      })
    ).resolves.toMatchObject({
      allowed: true,
      limit: 1,
      remaining: 0
    });
    await expect(
      service.consume({
        key: "client-secret-api-key",
        route: "POST /v1/verify",
        scope: "facilitator"
      })
    ).resolves.toMatchObject({
      allowed: false,
      limit: 1,
      remaining: 0
    });

    const events = await service.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      route: "POST /v1/verify",
      scope: "facilitator",
      limit: 1,
      remaining: 0
    });
    expect(events[0]?.key).not.toContain("client-secret-api-key");
  });
});
