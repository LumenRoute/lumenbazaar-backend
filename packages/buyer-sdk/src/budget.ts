export type BudgetConstraint = {
  maxAmountPerCall: string;
  maxTotalSpent: string;
  network: "stellar:testnet" | "stellar:pubnet";
  assetCode: string;
};

export type BudgetState = {
  totalSpent: string;
  callCount: number;
  remainingBudget: string;
};

/**
 * Budget Manager for limiting paid calls
 */
export class BudgetManager {
  private totalSpent: bigint = 0n;
  private callCount = 0;

  constructor(private constraint: BudgetConstraint) {}

  /**
   * Check if a call with this amount is within budget
   */
  canAfford(amount: string): boolean {
    const parsed = parseBudgetAmounts(amount, this.constraint);

    if (parsed === null) {
      return false;
    }

    // Check per-call limit
    if (parsed.amount > parsed.maxPerCall) {
      return false;
    }

    // Check total budget
    if (this.totalSpent + parsed.amount > parsed.maxTotal) {
      return false;
    }

    return true;
  }

  canAffordAtomic(amount: string, decimals = 7): boolean {
    return this.canAfford(atomicToDecimal(amount, decimals));
  }

  /**
   * Record a spending and update budget
   */
  recordSpending(amount: string): void {
    const parsed = parseBudgetAmounts(amount, this.constraint);

    if (parsed === null || this.totalSpent + parsed.amount > parsed.maxTotal) {
      throw new Error(`Amount exceeds budget: ${amount}`);
    }

    if (parsed.amount > parsed.maxPerCall) {
      throw new Error(`Amount exceeds budget: ${amount}`);
    }

    this.totalSpent += parsed.amount;
    this.callCount++;
  }

  recordSpendingAtomic(amount: string, decimals = 7): void {
    this.recordSpending(atomicToDecimal(amount, decimals));
  }

  /**
   * Get current budget state
   */
  getState(): BudgetState {
    const total = stringToBigInt(this.constraint.maxTotalSpent);
    const remaining = total - this.totalSpent;

    return {
      totalSpent: bigIntToString(this.totalSpent),
      callCount: this.callCount,
      remainingBudget: bigIntToString(remaining)
    };
  }

  /**
   * Get immutable budget limits for display and agent inspection.
   */
  getConstraint(): BudgetConstraint {
    return { ...this.constraint };
  }

  /**
   * Reset budget state
   */
  reset(): void {
    this.totalSpent = 0n;
    this.callCount = 0;
  }

  /**
   * Check if budget is exhausted
   */
  isExhausted(): boolean {
    const maxTotal = stringToBigInt(this.constraint.maxTotalSpent);
    return this.totalSpent >= maxTotal;
  }
}

/**
 * Convert string amount to BigInt (assuming stroops/smallest unit)
 */
function stringToBigInt(amount: string): bigint {
  const exactAmountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
  const trimmed = amount.trim();

  if (!exactAmountPattern.test(trimmed)) {
    throw new Error("Amount must be a positive decimal string");
  }

  const [wholePart = "0", decimalPart = ""] = trimmed.split(".");
  return BigInt(wholePart) * 10_000_000n + BigInt(decimalPart.padEnd(7, "0"));
}

/**
 * Convert BigInt to string amount
 */
function bigIntToString(amount: bigint): string {
  return amount.toString();
}

function atomicToDecimal(amount: string, decimals: number): string {
  if (!/^(?:0|[1-9]\d*)$/.test(amount) || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Atomic amount must be a non-negative integer string");
  }
  if (decimals === 0) return amount;
  const padded = amount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

/**
 * Create a budget manager
 */
export function createBudgetManager(constraint: BudgetConstraint): BudgetManager {
  return new BudgetManager(constraint);
}

/**
 * Create a default budget (1000 stroops max per call, 100,000 total)
 */
export function createDefaultBudget(
  network: "stellar:testnet" | "stellar:pubnet"
): BudgetConstraint {
  return {
    maxAmountPerCall: "1000",
    maxTotalSpent: "100000",
    network,
    assetCode: "USDC"
  };
}

function parseBudgetAmounts(amount: string, constraint: BudgetConstraint) {
  try {
    return {
      amount: stringToBigInt(amount),
      maxPerCall: stringToBigInt(constraint.maxAmountPerCall),
      maxTotal: stringToBigInt(constraint.maxTotalSpent)
    };
  } catch {
    return null;
  }
}
