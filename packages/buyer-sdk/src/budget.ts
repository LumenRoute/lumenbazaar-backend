import { type Decimal } from "@lumenbazaar/shared";

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
    const amountBig = stringToBigInt(amount);
    const maxPerCall = stringToBigInt(this.constraint.maxAmountPerCall);
    const maxTotal = stringToBigInt(this.constraint.maxTotalSpent);

    // Check per-call limit
    if (amountBig > maxPerCall) {
      return false;
    }

    // Check total budget
    if (this.totalSpent + amountBig > maxTotal) {
      return false;
    }

    return true;
  }

  /**
   * Record a spending and update budget
   */
  recordSpending(amount: string): void {
    if (!this.canAfford(amount)) {
      throw new Error(`Amount exceeds budget: ${amount}`);
    }

    this.totalSpent += stringToBigInt(amount);
    this.callCount++;
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
  try {
    return BigInt(amount.replace(/\D/g, "") || "0");
  } catch {
    return 0n;
  }
}

/**
 * Convert BigInt to string amount
 */
function bigIntToString(amount: bigint): string {
  return amount.toString();
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
