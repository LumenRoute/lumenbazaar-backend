import { describe, expect, it, vi } from "vitest";

import { ConformanceRunService, conformanceDefinitions } from "./conformance.js";

describe("ConformanceRunService", () => {
  it("runs exact checks and reserves upto checks separately", async () => {
    const runner = vi.fn(async () => ({
      checked: true
    }));
    const service = new ConformanceRunService(runner);

    const run = await service.run({
      network: "stellar:testnet"
    });

    expect(run).toMatchObject({
      network: "stellar:testnet",
      suite: "stellar-x402",
      status: "passed",
      passedCount: 3,
      failedCount: 0,
      reservedCount: 3,
      exactResults: 3
    });
    expect(run.results.filter((result) => result.scheme === "exact")).toHaveLength(3);
    expect(run.results.filter((result) => result.scheme === "upto")).toHaveLength(3);
    expect(runner).toHaveBeenCalledTimes(3);
    await expect(service.list({})).resolves.toEqual([run]);
    await expect(service.get(run.id)).resolves.toEqual(run);
  });

  it("records failed exact checks without treating reserved slots as failures", async () => {
    const runner = vi.fn(async (definition: { id: string }) => {
      if (definition.id === "exact-settle") {
        throw new Error("settlement failed");
      }
    });
    const service = new ConformanceRunService(runner);

    const run = await service.run({
      includeReserved: true,
      network: "stellar:testnet"
    });

    expect(run.status).toBe("failed");
    expect(run.failedCount).toBe(1);
    expect(run.reservedCount).toBe(3);
    expect(run.results.find((result) => result.id === "exact-settle")).toMatchObject({
      status: "failed",
      error: "settlement failed"
    });
  });

  it("can return only executable exact definitions", () => {
    expect(
      conformanceDefinitions("stellar:testnet", false).map((definition) => definition.id)
    ).toEqual(["exact-supported", "exact-verify", "exact-settle"]);
  });
});
