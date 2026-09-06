import { describe, expect, it } from "vitest";

import {
  buildExactPaymentRequest,
  normalizeOptions,
  parseLoadTestArgs,
  runScenario,
  runWorkerThroughputScenario,
  summarizeLatency,
  summarizeScenario
} from "./loadtest.js";

describe("load test runner", () => {
  it("summarizes latency percentiles and status counts", () => {
    expect(summarizeLatency([40, 10, 30, 20, 50])).toEqual({
      avg: 30,
      max: 50,
      min: 10,
      p50: 30,
      p95: 50,
      p99: 50
    });

    const summary = summarizeScenario({
      completedAt: "2026-09-06T00:00:01.000Z",
      concurrency: 2,
      durationMs: 1000,
      samples: [
        { durationMs: 10, ok: true, statusCode: 200 },
        { durationMs: 20, error: "boom", ok: false, statusCode: 500 },
        { durationMs: 30, error: "boom", ok: false }
      ],
      startedAt: "2026-09-06T00:00:00.000Z",
      target: "verify"
    });

    expect(summary).toMatchObject({
      errors: {
        boom: 2
      },
      failed: 2,
      ok: 1,
      requests: 3,
      requestsPerSecond: 3,
      statusCodes: {
        "200": 1,
        "500": 1,
        none: 1
      }
    });
  });

  it("parses CLI options and caps concurrency to request count", () => {
    expect(
      normalizeOptions(
        parseLoadTestArgs([
          "--base-url",
          "https://api.testnet.lumenbazaar.example",
          "--environment",
          "testnet",
          "--targets",
          "verify,search",
          "--requests",
          "5",
          "--concurrency",
          "10",
          "--search-query",
          "rag"
        ])
      )
    ).toMatchObject({
      baseUrl: "https://api.testnet.lumenbazaar.example",
      concurrency: 5,
      environment: "testnet",
      requests: 5,
      searchQuery: "rag",
      targets: ["verify", "search"]
    });
  });

  it("creates unique exact payment hashes for synthetic load requests", () => {
    const first = buildExactPaymentRequest(0, "load_run", "verify");
    const second = buildExactPaymentRequest(1, "load_run", "verify");

    expect(readPaymentHash(first)).toBe("load_run_verify_0");
    expect(readPaymentHash(second)).toBe("load_run_verify_1");
  });

  it("materializes JSON templates with per-request placeholders", () => {
    const request = buildExactPaymentRequest(7, "load_run", "settle", {
      paymentPayload: {
        scheme: "exact",
        paymentHash: "{paymentHash}",
        memo: "{runId}:{target}:{index}"
      }
    });

    expect(request).toMatchObject({
      paymentPayload: {
        memo: "load_run:settle:7",
        paymentHash: "load_run_settle_7"
      }
    });
  });

  it("runs bounded concurrent scenarios and records failures", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await runScenario("search", { concurrency: 3, requests: 8 }, async (index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;

      return index === 4
        ? { durationMs: 1, error: "planned", ok: false, statusCode: 503 }
        : { durationMs: 1, ok: true, statusCode: 200 };
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(result).toMatchObject({
      failed: 1,
      ok: 7,
      requests: 8,
      statusCodes: {
        "200": 7,
        "503": 1
      }
    });
  });

  it("records local worker throughput", async () => {
    const result = await runWorkerThroughputScenario(12, 4);

    expect(result).toMatchObject({
      failed: 0,
      ok: 12,
      requests: 12,
      target: "worker"
    });
    expect(result.requestsPerSecond).toBeGreaterThan(0);
  });
});

function readPaymentHash(request: unknown) {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return undefined;
  }

  const paymentPayload = (request as Record<string, unknown>).paymentPayload;

  if (
    typeof paymentPayload !== "object" ||
    paymentPayload === null ||
    Array.isArray(paymentPayload)
  ) {
    return undefined;
  }

  return (paymentPayload as Record<string, unknown>).paymentHash;
}
