import { type PaymentRequirement } from "./middleware.js";

/**
 * Builder for x402 Payment Requirements
 * Fluent API for constructing payment requirements
 */
export class PaymentRequirementBuilder {
  private requirement: Partial<PaymentRequirement> = {
    scheme: "exact"
  };

  /**
   * Set the network for this payment requirement
   */
  network(network: "stellar:testnet" | "stellar:pubnet"): this {
    this.requirement.network = network;
    return this;
  }

  /**
   * Set the asset code and issuer for this payment requirement
   */
  asset(code: string, issuer: string): this {
    this.requirement.asset = { code, issuer };
    return this;
  }

  /**
   * Set the payment amount (in stroops for Stellar)
   */
  amount(amount: string): this {
    this.requirement.amount = amount;
    return this;
  }

  /**
   * Set the recipient wallet address
   */
  payTo(address: string): this {
    this.requirement.payTo = address;
    return this;
  }

  /**
   * Build and validate the payment requirement
   */
  build(): PaymentRequirement {
    if (!this.requirement.network) {
      throw new Error("Network is required");
    }
    if (!this.requirement.asset) {
      throw new Error("Asset is required");
    }
    if (!this.requirement.amount) {
      throw new Error("Amount is required");
    }
    if (!this.requirement.payTo) {
      throw new Error("PayTo (recipient address) is required");
    }

    return this.requirement as PaymentRequirement;
  }
}

/**
 * Create a new payment requirement builder
 */
export function createPaymentRequirement(): PaymentRequirementBuilder {
  return new PaymentRequirementBuilder();
}

/**
 * Quick builder with all parameters
 */
export function paymentRequirement(params: {
  network: "stellar:testnet" | "stellar:pubnet";
  assetCode: string;
  assetIssuer: string;
  amount: string;
  payTo: string;
}): PaymentRequirement {
  return createPaymentRequirement()
    .network(params.network)
    .asset(params.assetCode, params.assetIssuer)
    .amount(params.amount)
    .payTo(params.payTo)
    .build();
}
