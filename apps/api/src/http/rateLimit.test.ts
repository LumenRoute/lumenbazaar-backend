import { describe, expect, it } from "vitest";

import { buildApiApp } from "../app.js";
import { RateLimitService } from "../services/rateLimit.js";
import { classifyRateLimitScope } from "./rateLimit.js";

describe("rate limit hook", () => {
  it("classifies facilitator, discovery, and seller endpoints", () => {
    expect(classifyRateLimitScope({ method: "POST", url: "/v1/verify" })).toBe("facilitator");
    expect(classifyRateLimitScope({ method: "GET", url: "/v1/discovery/search?q=weather" })).toBe(
      "discovery"
    );
    expect(classifyRateLimitScope({ method: "POST", url: "/v1/sellers" })).toBe("seller");
    expect(classifyRateLimitScope({ method: "GET", url: "/health" })).toBeUndefined();
  });

  it("returns standard 429 responses and records rate-limit events", async () => {
    const rateLimitService = new RateLimitService({
      rules: {
        facilitator: {
          limit: 1,
          windowMs: 60_000
        }
      }
    });
    const app = buildApiApp({
      logger: false,
      rateLimitService
    });

    const first = await app.inject({
      method: "GET",
      url: "/v1/supported",
      headers: {
        "x-api-key": "test-api-key"
      }
    });
    const second = await app.inject({
      method: "GET",
      url: "/v1/supported",
      headers: {
        "x-api-key": "test-api-key"
      }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Rate limit exceeded.",
        details: {
          scope: "facilitator"
        }
      }
    });
    expect(second.headers["x-ratelimit-limit"]).toBe("1");
    await expect(rateLimitService.listEvents()).resolves.toMatchObject([
      {
        route: "GET /v1/supported",
        scope: "facilitator"
      }
    ]);

    await app.close();
  });
});
