export type PaymentPayload = {
  scheme: "exact";
  network: "stellar:testnet" | "stellar:pubnet";
  asset: {
    code: string;
    issuer: string;
  };
  amount: string;
  payTo: string;
  memo?: string;
  expiresAtLedger?: number;
  authorization?: Record<string, unknown>;
};

export type PaymentPrepareInput = {
  network: "stellar:testnet" | "stellar:pubnet";
  assetCode: string;
  assetIssuer: string;
  amount: string;
  payTo?: string;
  recipient?: string;
  memo?: string;
  expiresAtLedger?: number;
  authorization?: Record<string, unknown>;
};

export type PaymentRequirements = {
  scheme: "exact";
  network: "stellar:testnet" | "stellar:pubnet";
  asset?: {
    code: string;
    issuer: string;
  };
  amount: string;
  payTo: string;
};

export type VerifyPaymentInput = {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  currentLedger?: number;
  resourceId?: string;
  sellerId?: string;
};

export type VerifyPaymentResult = {
  adapter: "@x402/stellar";
  network: "stellar:testnet" | "stellar:pubnet";
  paymentAttemptId: string;
  paymentHash: string;
  status: "verified";
};

export type SettlePaymentInput = VerifyPaymentInput & {
  paymentAttemptId: string;
};

export type SettlePaymentResult = {
  ledger: number;
  network: "stellar:testnet" | "stellar:pubnet";
  receiptId: string;
  settlementId: string;
  status: "settled";
  transactionHash: string;
};

/**
 * Prepare a payment payload for verification
 * @param input - Payment preparation input
 */
export function preparePaymentPayload(input: PaymentPrepareInput): PaymentPayload {
  const payTo = input.payTo ?? input.recipient;

  if (payTo === undefined || payTo.trim().length === 0) {
    throw new Error("Payment recipient is required");
  }

  const result: PaymentPayload = {
    scheme: "exact",
    network: input.network,
    asset: {
      code: input.assetCode,
      issuer: input.assetIssuer
    },
    amount: input.amount,
    payTo
  };

  // Add optional fields only if defined
  if (input.memo !== undefined) {
    result.memo = input.memo;
  }
  if (input.expiresAtLedger !== undefined) {
    result.expiresAtLedger = input.expiresAtLedger;
  }
  if (input.authorization !== undefined) {
    result.authorization = input.authorization;
  }

  return result;
}

/**
 * Create a payment payload from resource payment terms
 */
export function createPaymentPayloadFromResource(
  resourcePaymentTerms: {
    network: "stellar:testnet" | "stellar:pubnet";
    asset: { code: string; issuer: string };
    amount: string;
    payTo: string;
  },
  options: { authorization?: Record<string, unknown>; expiresAtLedger?: number } = {}
): PaymentPayload {
  const input: PaymentPrepareInput = {
    network: resourcePaymentTerms.network,
    assetCode: resourcePaymentTerms.asset.code,
    assetIssuer: resourcePaymentTerms.asset.issuer,
    amount: resourcePaymentTerms.amount,
    payTo: resourcePaymentTerms.payTo
  };

  if (options.expiresAtLedger !== undefined) {
    input.expiresAtLedger = options.expiresAtLedger;
  }
  if (options.authorization !== undefined) {
    input.authorization = options.authorization;
  }

  return preparePaymentPayload(input);
}

/**
 * Check if a payment payload is expired
 */
export function isPaymentExpired(payload: PaymentPayload): boolean {
  if (!payload.expiresAtLedger) {
    return false;
  }

  return false;
}

/**
 * Get time remaining for payment expiry in seconds
 */
export function getPaymentTimeRemaining(_payload: PaymentPayload): number | null {
  return null;
}

export function isPaymentExpiredAtLedger(payload: PaymentPayload, currentLedger: number): boolean {
  if (!payload.expiresAtLedger) {
    return false;
  }

  return payload.expiresAtLedger <= currentLedger;
}

export function getPaymentLedgerTimeRemaining(
  payload: PaymentPayload,
  currentLedger: number
): number | null {
  if (!payload.expiresAtLedger) {
    return null;
  }

  return Math.max(0, payload.expiresAtLedger - currentLedger);
}

/**
 * Verify payment payload has all required fields
 */
export function validatePaymentPayload(payload: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["Payment payload must be an object"] };
  }

  const p = payload as Record<string, unknown>;

  if (p.scheme !== "exact") {
    errors.push("Payment scheme must be 'exact'");
  }

  if (!["stellar:testnet", "stellar:pubnet"].includes(String(p.network))) {
    errors.push("Network must be 'stellar:testnet' or 'stellar:pubnet'");
  }

  if (!p.asset || typeof p.asset !== "object") {
    errors.push("Asset is required");
  } else {
    const asset = p.asset as Record<string, unknown>;
    if (!asset.code) errors.push("Asset code is required");
    if (!asset.issuer) errors.push("Asset issuer is required");
  }

  if (!p.amount || typeof p.amount !== "string") {
    errors.push("Amount is required");
  }

  if (!p.payTo || typeof p.payTo !== "string") {
    errors.push("Recipient is required");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Serialize payment payload to JSON string for transmission
 */
export function serializePaymentPayload(payload: PaymentPayload): string {
  return JSON.stringify({
    scheme: payload.scheme,
    network: payload.network,
    asset: payload.asset,
    amount: payload.amount,
    payTo: payload.payTo,
    memo: payload.memo,
    expiresAtLedger: payload.expiresAtLedger,
    authorization: payload.authorization
  });
}

/**
 * Deserialize payment payload from JSON string
 */
export function deserializePaymentPayload(json: string): PaymentPayload {
  try {
    return JSON.parse(json) as PaymentPayload;
  } catch (err) {
    throw new Error(`Invalid payment payload JSON: ${err}`);
  }
}

/**
 * Create payment requirements for API headers
 */
export function createPaymentHeaders(payload: PaymentPayload): Record<string, string> {
  return {
    "x-payment-required": serializePaymentPayload(payload),
    "x-payment-scheme": payload.scheme
  };
}

export async function verifyPayment(
  apiUrl: string,
  input: VerifyPaymentInput
): Promise<VerifyPaymentResult> {
  return postJson<VerifyPaymentResult>(apiUrl, "/v1/verify", input);
}

export async function settlePayment(
  apiUrl: string,
  input: SettlePaymentInput
): Promise<SettlePaymentResult> {
  return postJson<SettlePaymentResult>(apiUrl, "/v1/settle", input);
}

async function postJson<T>(apiUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await readJson(response);
    throw new Error(extractApiErrorMessage(errorBody, response.statusText));
  }

  return response.json() as Promise<T>;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function extractApiErrorMessage(body: unknown, fallback: string) {
  if (typeof body !== "object" || body === null) {
    return fallback;
  }

  const record = body as Record<string, unknown>;
  const error = record.error;

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  return fallback;
}
