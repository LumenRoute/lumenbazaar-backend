import { type JsonObject } from "@lumenbazaar/shared";

export type PaymentPayload = {
  scheme: "exact";
  network: "stellar:testnet" | "stellar:pubnet";
  asset: {
    code: string;
    issuer: string;
  };
  amount: string;
  recipient: string;
  memo?: string;
  expires?: number;
  auth?: {
    selector: string;
    signature: string;
  };
};

export type PaymentPrepareInput = {
  network: "stellar:testnet" | "stellar:pubnet";
  assetCode: string;
  assetIssuer: string;
  amount: string;
  recipient: string;
  memo?: string;
  expiresInSeconds?: number;
};

/**
 * Prepare a payment payload for verification
 * @param input - Payment preparation input
 */
export function preparePaymentPayload(input: PaymentPrepareInput): PaymentPayload {
  const expires = input.expiresInSeconds ? Date.now() + input.expiresInSeconds * 1000 : undefined;

  return {
    scheme: "exact",
    network: input.network,
    asset: {
      code: input.assetCode,
      issuer: input.assetIssuer
    },
    amount: input.amount,
    recipient: input.recipient,
    memo: input.memo,
    expires
  };
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
  expiresInSeconds?: number
): PaymentPayload {
  return preparePaymentPayload({
    network: resourcePaymentTerms.network,
    assetCode: resourcePaymentTerms.asset.code,
    assetIssuer: resourcePaymentTerms.asset.issuer,
    amount: resourcePaymentTerms.amount,
    recipient: resourcePaymentTerms.payTo,
    expiresInSeconds
  });
}

/**
 * Check if a payment payload is expired
 */
export function isPaymentExpired(payload: PaymentPayload): boolean {
  if (!payload.expires) {
    return false;
  }

  return Date.now() > payload.expires;
}

/**
 * Get time remaining for payment expiry in seconds
 */
export function getPaymentTimeRemaining(payload: PaymentPayload): number | null {
  if (!payload.expires) {
    return null;
  }

  const remaining = Math.ceil((payload.expires - Date.now()) / 1000);
  return Math.max(0, remaining);
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

  if (!p.recipient || typeof p.recipient !== "string") {
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
    recipient: payload.recipient,
    memo: payload.memo,
    expires: payload.expires,
    auth: payload.auth
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
export function createPaymentHeaders(
  payload: PaymentPayload
): Record<string, string> {
  return {
    "x-payment-required": serializePaymentPayload(payload),
    "x-payment-scheme": payload.scheme
  };
}
