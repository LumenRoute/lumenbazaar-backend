import {
  createBudgetManager,
  createDefaultBudget,
  runPaidResourceFlow,
  type CallOptions,
  type BudgetManager,
  type PaymentPayload,
  type PaymentRequirements
} from "@lumenbazaar/buyer-sdk";

import { BackendClient } from "./client.js";
import { PermissionError } from "./errors.js";

type ExactResourcePaymentRequirements = PaymentRequirements;

export type McpPaymentToolServiceOptions = {
  apiUrl?: string;
  budgetManager?: BudgetManager;
  client?: BackendClient;
};

export type PreparePaymentInput = {
  resourceId: string;
};

export type CallPaidResourceInput = CallOptions & {
  paymentPayload: PaymentPayload;
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

    return {
      resourceId: input.resourceId,
      paymentRequirements,
      requiresWalletSignature: true,
      budget: this.inspectBudget()
    };
  }

  async callPaidResource(input: CallPaidResourceInput) {
    const resource = await this.client.getResource(input.resourceId);
    const paymentRequirements = paymentTermsFromResource(resource);
    const registeredUrl = requireString(resource.url, "url");

    if (
      input.resourceUrl !== undefined &&
      normalizeUrl(input.resourceUrl) !== normalizeUrl(registeredUrl)
    ) {
      throw new PermissionError("Paid calls must use the cataloged resource URL.");
    }

    this.assertWithinBudget(paymentRequirements);

    const flow = await runPaidResourceFlow({
      apiUrl: this.apiUrl,
      budgetManager: this.budgetManager,
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
      ...(input.method === undefined ? {} : { method: input.method }),
      paymentPayload: input.paymentPayload,
      resourceUrl: registeredUrl,
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
    if (!this.budgetManager.canAffordAtomic(paymentRequirements.amount)) {
      throw new PermissionError("Local payment budget cap exceeded.");
    }
  }
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
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
    asset: requireAssetContract(resource),
    amount: decimalToAtomic(requireString(resource.amount, "amount")),
    payTo: requireString(resource.payTo, "payTo"),
    maxTimeoutSeconds: 60,
    extra: {
      assetCode: requireString(resource.assetCode, "assetCode"),
      assetIssuer: requireString(resource.assetIssuer, "assetIssuer")
    }
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
    typeof (value as ExactResourcePaymentRequirements).asset === "string" &&
    typeof (value as PaymentRequirements).amount === "string" &&
    typeof (value as PaymentRequirements).payTo === "string"
  );
}

function requireAssetContract(resource: Record<string, unknown>) {
  if (typeof resource.assetContractId === "string") return resource.assetContractId;
  const extensions = resource.extensions;
  if (typeof extensions === "object" && extensions !== null && !Array.isArray(extensions)) {
    const contractId = (extensions as Record<string, unknown>).assetContractId;
    if (typeof contractId === "string") return contractId;
  }
  throw new Error("Resource assetContractId is required");
}

function decimalToAtomic(amount: string) {
  const [whole, fraction = ""] = amount.split(".");
  if (!/^\d+$/.test(whole ?? "") || !/^\d*$/.test(fraction) || fraction.length > 7) {
    throw new Error("Resource amount must use at most seven decimal places");
  }
  return `${whole}${fraction.padEnd(7, "0")}`.replace(/^0+(?=\d)/, "");
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
