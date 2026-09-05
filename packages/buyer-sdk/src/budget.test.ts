import { describe, expect, it } from "vitest";

import { createBudgetManager } from "./budget.js";

describe("buyer SDK budget manager", () => {
  it("tracks decimal Stellar amounts with fixed seven-decimal precision", () => {
    const budget = createBudgetManager({
      maxAmountPerCall: "0.50",
      maxTotalSpent: "1.00",
      network: "stellar:testnet",
      assetCode: "USDC"
    });

    expect(budget.canAfford("0.05")).toBe(true);
    expect(budget.canAfford("0.5000001")).toBe(false);

    budget.recordSpending("0.05");
    expect(budget.getState()).toMatchObject({
      totalSpent: "500000"
    });
  });

  it("rejects malformed budget amounts instead of stripping characters", () => {
    const budget = createBudgetManager({
      maxAmountPerCall: "1",
      maxTotalSpent: "1",
      network: "stellar:testnet",
      assetCode: "USDC"
    });

    expect(budget.canAfford("1abc")).toBe(false);
    expect(() => budget.recordSpending("1abc")).toThrow("Amount exceeds budget");
  });
});
