import { type JsonObject } from "@lumenbazaar/shared";

export type MockFacilitatorOptions = {
  supportedNetworks?: string[];
  supportedAssets?: { code: string; issuer: string }[];
  verifyDelay?: number;
  settleDelay?: number;
  simulateErrors?: boolean;
};

/**
 * Mock x402 Facilitator for testing
 * Simulates the facilitator endpoints without requiring actual Stellar network
 */
export class MockFacilitator {
  private verifications = new Map<string, unknown>();
  private settlements = new Map<string, unknown>();
  private options: Required<MockFacilitatorOptions>;

  constructor(options: MockFacilitatorOptions = {}) {
    this.options = {
      supportedNetworks: options.supportedNetworks || ["stellar:testnet", "stellar:pubnet"],
      supportedAssets: options.supportedAssets || [
        { code: "USDC", issuer: "GDZST3XVCDTUJ76ZAV2HA72KYRTYKYI6YLJVMQ5DNPMJR7BKQW5EBXM" }
      ],
      verifyDelay: options.verifyDelay || 0,
      settleDelay: options.settleDelay || 0,
      simulateErrors: options.simulateErrors || false
    };
  }

  /**
   * Mock /v1/supported endpoint
   */
  getSupported(): JsonObject {
    return {
      schemes: this.options.supportedNetworks.map((network) => ({
        name: "exact",
        network,
        assets: this.options.supportedAssets.map((asset) => ({
          code: asset.code,
          issuer: asset.issuer,
          decimals: 7
        })),
        extensions: {
          x402Version: "1",
          upto: false
        }
      })),
      extensions: {
        bazaar: true,
        upto: false,
        uptoContracts: []
      }
    };
  }

  /**
   * Mock /v1/verify endpoint
   */
  async verify(payload: unknown): Promise<JsonObject> {
    if (this.options.verifyDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.verifyDelay));
    }

    if (this.options.simulateErrors) {
      return {
        valid: false,
        failureCode: "INVALID_SIGNATURE",
        failureReason: "Simulated verification failure"
      };
    }

    const paymentHash = JSON.stringify(payload)
      .split("")
      .reduce((acc, c) => acc + c.charCodeAt(0), 0)
      .toString(16);

    this.verifications.set(paymentHash, payload);

    return {
      valid: true,
      paymentAttemptId: `attempt_${paymentHash}`,
      paymentHash
    };
  }

  /**
   * Mock /v1/settle endpoint
   */
  async settle(input: unknown): Promise<JsonObject> {
    if (this.options.settleDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.settleDelay));
    }

    if (this.options.simulateErrors) {
      return {
        code: "SETTLEMENT_FAILED",
        message: "Simulated settlement failure"
      };
    }

    const inputObj = input as Record<string, unknown>;
    const settlementId = `settlement_${Math.random().toString(36).slice(2, 9)}`;
    const transactionHash = `tx_${Math.random().toString(36).slice(2, 64)}`;

    this.settlements.set(settlementId, inputObj);

    return {
      settlementId,
      receiptId: `receipt_${Math.random().toString(36).slice(2, 9)}`,
      transactionHash,
      ledger: Math.floor(Math.random() * 1000000),
      network: (inputObj.network as string) || "stellar:testnet",
      status: "settled"
    };
  }

  /**
   * Mock /v1/receipts/:receiptId endpoint
   */
  getReceipt(receiptId: string): JsonObject {
    return {
      id: receiptId,
      status: "finalized",
      transactionHash: `tx_${Math.random().toString(36).slice(2, 64)}`,
      ledger: Math.floor(Math.random() * 1000000),
      settledAt: new Date().toISOString()
    };
  }

  /**
   * Get all verifications made
   */
  getVerifications(): Map<string, unknown> {
    return new Map(this.verifications);
  }

  /**
   * Get all settlements made
   */
  getSettlements(): Map<string, unknown> {
    return new Map(this.settlements);
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.verifications.clear();
    this.settlements.clear();
  }
}

/**
 * Create a mock facilitator instance
 */
export function createMockFacilitator(options?: MockFacilitatorOptions): MockFacilitator {
  return new MockFacilitator(options);
}
