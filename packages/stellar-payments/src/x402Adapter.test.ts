import { describe, expect, it } from "vitest";

import { createX402StellarAdapter } from "./x402Adapter.js";

describe("default x402 Stellar adapter", () => {
  it("fails closed while no facilitator implementation is configured", async () => {
    const adapter = createX402StellarAdapter();

    await expect(
      adapter.verifyExact({} as Parameters<typeof adapter.verifyExact>[0])
    ).resolves.toMatchObject({
      adapter: "@x402/stellar",
      failureCode: "SETTLEMENT_FAILED",
      valid: false
    });
    expect(adapter.settleExact).toBeUndefined();
  });
});
