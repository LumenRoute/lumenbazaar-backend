import { type JsonObject } from "@lumenbazaar/shared";
import { type BudgetManager } from "./budget.js";
import { inspectResource, type ResourceMetadata } from "./inspect.js";
import {
  createPaymentPayloadFromResource,
  settlePayment,
  type PaymentPayload,
  type SettlePaymentResult,
  verifyPayment,
  type VerifyPaymentResult
} from "./payment.js";

export type CallOptions = {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type CallResult = {
  success: boolean;
  statusCode?: number;
  data?: JsonObject;
  error?: string;
  receipt?: {
    receiptId: string;
    transactionHash: string;
    ledger: number;
  };
};

export type RetryConfig = {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
};

export type ReceiptResult = {
  id: string;
  transactionHash: string;
  ledger: number;
  status: string;
  settledAt: string;
};

export type PaidResourceFlowOptions = CallOptions & {
  apiUrl: string;
  authorization?: Record<string, unknown>;
  budgetManager?: BudgetManager;
  currentLedger?: number;
  expiresAtLedger?: number;
  paymentPayload?: PaymentPayload;
  resourceId: string;
  resourceUrl?: string;
};

export type PaidResourceFlowResult = {
  call: CallResult;
  paymentPayload: PaymentPayload;
  receipt?: ReceiptResult;
  resource: ResourceMetadata;
  settlement?: SettlePaymentResult;
  verification: VerifyPaymentResult;
};

/**
 * Call a paid resource with automatic retry logic
 */
export async function callPaidResource(
  url: string,
  paymentPayload: PaymentPayload,
  options: CallOptions = {}
): Promise<CallResult> {
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 30000;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await makePaymentRequest(url, paymentPayload, {
        ...options,
        timeoutMs
      });

      if (result.success) {
        return result;
      }

      // If 402 Payment Required, don't retry
      if (result.statusCode === 402) {
        return result;
      }

      // If last attempt or non-retryable error, return error
      if (attempt === maxRetries || isNonRetryable(result.statusCode ?? 0)) {
        return result;
      }

      lastError = new Error(result.error || "Request failed");
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // If last attempt, throw
      if (attempt === maxRetries) {
        throw lastError;
      }
    }

    // Wait before retrying with exponential backoff
    if (attempt < maxRetries) {
      const delay = retryDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Failed to call paid resource");
}

export async function runPaidResourceFlow(
  options: PaidResourceFlowOptions
): Promise<PaidResourceFlowResult> {
  const resource = await inspectResource(options.apiUrl, options.resourceId);
  const paymentOptions = {
    ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
    ...(options.expiresAtLedger === undefined ? {} : { expiresAtLedger: options.expiresAtLedger })
  };
  const paymentPayload =
    options.paymentPayload ??
    createPaymentPayloadFromResource(resource.paymentTerms, paymentOptions);

  if (
    options.budgetManager !== undefined &&
    !options.budgetManager.canAfford(resource.paymentTerms.amount)
  ) {
    throw new Error(`Amount exceeds budget: ${resource.paymentTerms.amount}`);
  }

  const verification = await verifyPayment(options.apiUrl, {
    paymentPayload,
    paymentRequirements: resource.paymentTerms,
    ...(options.currentLedger === undefined ? {} : { currentLedger: options.currentLedger }),
    resourceId: resource.id
  });

  const call = await callPaidResource(options.resourceUrl ?? resource.url, paymentPayload, options);

  if (!call.success) {
    return {
      call,
      paymentPayload,
      resource,
      verification
    };
  }

  const settlement = await settlePayment(options.apiUrl, {
    paymentAttemptId: verification.paymentAttemptId,
    paymentPayload,
    paymentRequirements: resource.paymentTerms,
    ...(options.currentLedger === undefined ? {} : { currentLedger: options.currentLedger }),
    resourceId: resource.id
  });
  const receipt = await fetchReceipt(options.apiUrl, settlement.receiptId);

  options.budgetManager?.recordSpending(resource.paymentTerms.amount);

  return {
    call,
    paymentPayload,
    receipt,
    resource,
    settlement,
    verification
  };
}

/**
 * Make a single payment request to a resource
 */
async function makePaymentRequest(
  url: string,
  paymentPayload: PaymentPayload,
  options: CallOptions = {}
): Promise<CallResult> {
  const timeoutMs = options.timeoutMs ?? 30000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers
    };

    // Add payment payload to headers
    headers["x-payment-required"] = JSON.stringify(paymentPayload);
    headers["x-payment-scheme"] = paymentPayload.scheme;

    const response = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      if (response.status === 402) {
        return {
          success: false,
          statusCode: 402,
          error: "Payment Required"
        };
      }

      return {
        success: false,
        statusCode: response.status,
        error: response.statusText
      };
    }

    const data = (await response.json()) as JsonObject;

    return {
      success: true,
      statusCode: response.status,
      data
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: error || "Unknown error"
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if an HTTP status code is retryable
 */
function isNonRetryable(statusCode: number): boolean {
  // Don't retry client errors (4xx) except 429 (rate limit) and 408 (timeout)
  if (statusCode >= 400 && statusCode < 500) {
    return ![408, 429].includes(statusCode);
  }

  return false;
}

/**
 * Fetch a receipt from the Bazaar API
 */
export async function fetchReceipt(apiUrl: string, receiptId: string): Promise<ReceiptResult> {
  const response = await fetch(`${apiUrl}/v1/receipts/${receiptId}`, {
    method: "GET"
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Receipt not found: ${receiptId}`);
    }
    throw new Error(`Failed to fetch receipt: ${response.statusText}`);
  }

  const receipt = (await response.json()) as Record<string, unknown>;

  return {
    id: receipt.id as string,
    transactionHash: receipt.transactionHash as string,
    ledger: receipt.ledger as number,
    status: receipt.status as string,
    settledAt: receipt.settledAt as string
  };
}
