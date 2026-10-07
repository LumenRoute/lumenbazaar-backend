import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { PaymentPayloadV2Schema, type PaymentPayloadV2 } from "@x402/core/schemas";

import {
  type ExactStellarPaymentPayload,
  type ExactStellarPaymentRequirements,
  type LumenSettleResponse,
  type LumenVerifyResponse,
  paymentSignatureHeader
} from "@lumenbazaar/stellar-payments";

export type PaymentPayload = ExactStellarPaymentPayload;
export type PaymentRequirements = ExactStellarPaymentRequirements;

export type PaymentPrepareInput = {
  paymentRequirements: PaymentRequirements;
  transaction: string;
  resource?: {
    url: string;
    description?: string;
    mimeType?: string;
  };
};

export type VerifyPaymentInput = {
  x402Version: 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

export type VerifyPaymentResult = LumenVerifyResponse;

export type SettlePaymentInput = VerifyPaymentInput;

export type SettlePaymentResult = LumenSettleResponse;

export function preparePaymentPayload(input: PaymentPrepareInput): PaymentPayload {
  assertCanonicalBase64(input.transaction);
  return {
    x402Version: 2,
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    accepted: input.paymentRequirements,
    payload: {
      transaction: input.transaction
    }
  };
}

export function createPaymentPayloadFromResource(
  paymentRequirements: PaymentRequirements,
  options: { transaction: string; resource?: PaymentPrepareInput["resource"] }
): PaymentPayload {
  return preparePaymentPayload({
    paymentRequirements,
    transaction: options.transaction,
    ...(options.resource === undefined ? {} : { resource: options.resource })
  });
}

export function validatePaymentPayload(payload: unknown): {
  valid: boolean;
  errors: string[];
} {
  const parsed = PaymentPayloadV2Schema.safeParse(payload);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => issue.message)
    };
  }

  const transaction = parsed.data.payload.transaction;
  if (parsed.data.accepted.scheme !== "exact" || typeof transaction !== "string") {
    return { valid: false, errors: ["Payload must use Stellar exact with a transaction."] };
  }

  try {
    assertCanonicalBase64(transaction);
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function serializePaymentPayload(payload: PaymentPayload): string {
  return encodePaymentSignatureHeader(payload);
}

export function deserializePaymentPayload(encoded: string): PaymentPayload {
  const decoded = decodePaymentSignatureHeader(encoded);
  const parsed = PaymentPayloadV2Schema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("PAYMENT-SIGNATURE does not contain an x402 v2 payload.");
  }
  return parsed.data as PaymentPayloadV2 as PaymentPayload;
}

export function createPaymentHeaders(payload: PaymentPayload): Record<string, string> {
  return {
    [paymentSignatureHeader]: serializePaymentPayload(payload)
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

function assertCanonicalBase64(value: string) {
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length === 0 ||
    decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")
  ) {
    throw new Error("Stellar transaction must be canonical base64.");
  }
}

async function postJson<T>(apiUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  if (typeof body !== "object" || body === null) return fallback;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return typeof record.message === "string" ? record.message : fallback;
}
