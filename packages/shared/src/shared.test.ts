import { describe, expect, it } from "vitest";

import {
  LumenError,
  decodeCursor,
  encodeCursor,
  failure,
  normalizeLimit,
  success
} from "./index.js";

describe("shared primitives", () => {
  it("wraps successful and failed API responses", () => {
    expect(success({ id: "ok" }, "req_1")).toEqual({
      ok: true,
      data: { id: "ok" },
      requestId: "req_1"
    });
    expect(failure({ code: "VALIDATION_FAILED", message: "Invalid" })).toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "Invalid" }
    });
  });

  it("keeps stable error metadata on LumenError", () => {
    const error = new LumenError("UNSUPPORTED_NETWORK", "Network not supported");

    expect(error.code).toBe("UNSUPPORTED_NETWORK");
    expect(error.statusCode).toBe(400);
  });

  it("normalizes pagination limits and round-trips cursors", () => {
    const cursor = encodeCursor({ id: "resource_1", createdAt: "2026-09-03T00:00:00.000Z" });

    expect(normalizeLimit(undefined)).toBe(25);
    expect(normalizeLimit(500)).toBe(100);
    expect(decodeCursor(cursor)).toEqual({
      id: "resource_1",
      createdAt: "2026-09-03T00:00:00.000Z"
    });
  });
});
