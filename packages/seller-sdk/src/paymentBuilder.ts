import { type PaymentRequirement } from "./middleware.js";

export class PaymentRequirementBuilder {
  private requirement: Partial<PaymentRequirement> = {
    scheme: "exact",
    maxTimeoutSeconds: 60,
    extra: {}
  };

  network(network: "stellar:testnet" | "stellar:pubnet"): this {
    this.requirement.network = network;
    return this;
  }

  asset(contractId: string, metadata: Record<string, unknown> = {}): this {
    this.requirement.asset = contractId;
    this.requirement.extra = metadata;
    return this;
  }

  amount(amount: string): this {
    this.requirement.amount = amount;
    return this;
  }

  payTo(address: string): this {
    this.requirement.payTo = address;
    return this;
  }

  timeout(seconds: number): this {
    this.requirement.maxTimeoutSeconds = seconds;
    return this;
  }

  build(): PaymentRequirement {
    if (this.requirement.network === undefined) throw new Error("Network is required");
    if (this.requirement.asset === undefined) throw new Error("SEP-41 asset contract is required");
    if (this.requirement.amount === undefined || !/^[1-9]\d*$/.test(this.requirement.amount)) {
      throw new Error("Amount must be a positive atomic-unit integer");
    }
    if (this.requirement.payTo === undefined) throw new Error("PayTo is required");
    return this.requirement as PaymentRequirement;
  }
}

export function createPaymentRequirement(): PaymentRequirementBuilder {
  return new PaymentRequirementBuilder();
}

export function paymentRequirement(params: {
  network: "stellar:testnet" | "stellar:pubnet";
  assetContractId: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  assetCode?: string;
  assetIssuer?: string;
}): PaymentRequirement {
  const metadata = {
    ...(params.assetCode === undefined ? {} : { assetCode: params.assetCode }),
    ...(params.assetIssuer === undefined ? {} : { assetIssuer: params.assetIssuer })
  };
  return createPaymentRequirement()
    .network(params.network)
    .asset(params.assetContractId, metadata)
    .amount(params.amount)
    .payTo(params.payTo)
    .timeout(params.maxTimeoutSeconds ?? 60)
    .build();
}
