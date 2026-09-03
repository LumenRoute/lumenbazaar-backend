import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LumenError } from "@lumenbazaar/shared";

import { buildApiApp } from "./app.js";
import { parseBody } from "./http/validation.js";

describe("API server base", () => {
  it("adds request IDs to responses", async () => {
    const app = buildApiApp({ logger: false });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBeDefined();
    await app.close();
  });

  it("returns stable envelopes for application errors", async () => {
    const app = buildApiApp({ logger: false });
    app.get("/boom", async () => {
      throw new LumenError("UNSUPPORTED_NETWORK", "Network not supported.");
    });

    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_NETWORK",
        message: "Network not supported."
      }
    });
    await app.close();
  });

  it("maps JSON schema validation failures to stable errors", async () => {
    const app = buildApiApp({ logger: false });
    app.post(
      "/schema-check",
      {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" }
            }
          }
        }
      },
      async () => ({ ok: true })
    );

    const response = await app.inject({
      method: "POST",
      url: "/schema-check",
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("maps Zod parsing failures to stable errors", async () => {
    const app = buildApiApp({ logger: false });
    app.post("/zod-check", async (request) => {
      parseBody(request, z.object({ amount: z.string().regex(/^\d+$/) }));
      return { ok: true };
    });

    const response = await app.inject({
      method: "POST",
      url: "/zod-check",
      payload: { amount: "bad" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    await app.close();
  });
});
