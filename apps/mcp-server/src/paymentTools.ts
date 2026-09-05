import {
  createBudgetManager,
  createDefaultBudget,
  createPaymentPayloadFromResource,
  runPaidResourceFlow,
  type CallOptions,
  type BudgetManager,
  type PaymentPayload,
  type PaymentRequirements
} from "@lumenbazaar/buyer-sdk";

import { BackendClient } from "./client.js";

type ExactResourcePaymentRequirements = PaymentRequirements & {
  asset: {
    code: string;
    issuer: string;
  };
};

export type McpPaymentToolServiceOptions = {
  apiUrl?: string;
  budgetManager?: BudgetManager;
  client?: BackendClient;
};

export type PreparePaymentInput = {
  authorization?: Record<string, unknown>;
  expiresAtLedger?: number;
  resourceId: string;
};

export type CallPaidResourceInput = CallOptions & {
  authorization?: Record<string, unknown>;
  currentLedger?: number;
  expiresAtLedger?: number;
  paymentPayload?: PaymentPayload;
  resourceId: string;
  resourceUrl?: string;
};

export type GetPaymentReceiptInput = {
  receiptId: string;
};

export class McpPaymentToolService {
  private readonly apiUrl: string;
  private readonly budgetManager: BudgetManager;
  private readonly client: BackendClient;

  constructor(options: McpPaymentToolServiceOptions = {}) {
    this.client = options.client ?? new BackendClient(options.apiUrl);
    this.apiUrl = options.apiUrl ?? this.client.getBaseUrl();
    this.budgetManager =
      options.budgetManager ?? createBudgetManager(createDefaultBudget("stellar:testnet"));
  }

  async preparePayment(input: PreparePaymentInput) {
    const resource = await this.client.getResource(input.resourceId);
    const paymentRequirements = paymentTermsFromResource(resource);

    this.assertWithinBudget(paymentRequirements);

    const paymentPayload = createPaymentPayloadFromResource(paymentRequirements, {
      ...(input.authorization === undefined ? {} : { authorization: input.authorization }),
      ...(input.expiresAtLedger === undefined ? {} : { expiresAtLedger: input.expiresAtLedger })
    });

    return {
      resourceId: input.resourceId,
      paymentPayload,
      paymentRequirements,
      budget: this.inspectBudget()
    };
  }

  async callPaidResource(input: CallPaidResourceInput) {
    const resource = await this.client.getResource(input.resourceId);
    const paymentRequirements = paymentTermsFromResource(resource);

    this.assertWithinBudget(paymentRequirements);

    const flow = await runPaidResourceFlow({
      apiUrl: this.apiUrl,
      budgetManager: this.budgetManager,
      ...(input.authorization === undefined ? {} : { authorization: input.authorization }),
      ...(input.currentLedger === undefined ? {} : { currentLedger: input.currentLedger }),
      ...(input.expiresAtLedger === undefined ? {} : { expiresAtLedger: input.expiresAtLedger }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
      ...(input.paymentPayload === undefined ? {} : { paymentPayload: input.paymentPayload }),
      ...(input.resourceUrl === undefined ? {} : { resourceUrl: input.resourceUrl }),
      ...(input.retryDelayMs === undefined ? {} : { retryDelayMs: input.retryDelayMs }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      resourceId: input.resourceId
    });

    return {
      ...flow,
      budget: this.inspectBudget()
    };
  }

  async getPaymentReceipt(input: GetPaymentReceiptInput) {
    return this.client.getReceipt(input.receiptId);
  }

  inspectBudget() {
    return {
      constraint: this.budgetManager.getConstraint(),
      state: this.budgetManager.getState()
    };
  }

  private assertWithinBudget(paymentRequirements: ExactResourcePaymentRequirements) {
    if (!this.budgetManager.canAfford(paymentRequirements.amount)) {
      throw new Error(`Local budget cap exceeded for amount ${paymentRequirements.amount}`);
    }
  }
}

function paymentTermsFromResource(
  resource: Record<string, unknown>
): ExactResourcePaymentRequirements {
  const terms = resource.paymentTerms;

  if (isResourcePaymentTerms(terms)) {
    return terms;
  }

  return {
    scheme: "exact",
    network: requireNetwork(resource.network),
    asset: {
      code: requireString(resource.assetCode, "assetCode"),
      issuer: requireString(resource.assetIssuer, "assetIssuer")
    },
    amount: requireString(resource.amount, "amount"),
    payTo: requireString(resource.payTo, "payTo")
  };
}

function isResourcePaymentTerms(value: unknown): value is ExactResourcePaymentRequirements {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as PaymentRequirements).scheme === "exact" &&
    ((value as PaymentRequirements).network === "stellar:testnet" ||
      (value as PaymentRequirements).network === "stellar:pubnet") &&
    typeof (value as ExactResourcePaymentRequirements).asset === "object" &&
    (value as ExactResourcePaymentRequirements).asset !== null &&
    typeof (value as PaymentRequirements).amount === "string" &&
    typeof (value as PaymentRequirements).payTo === "string"
  );
}

function requireNetwork(value: unknown): "stellar:testnet" | "stellar:pubnet" {
  if (value === "stellar:testnet" || value === "stellar:pubnet") {
    return value;
  }

  throw new Error("Resource network is not supported by the payment tools");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Resource ${field} is required`);
  }

  return value;
}
