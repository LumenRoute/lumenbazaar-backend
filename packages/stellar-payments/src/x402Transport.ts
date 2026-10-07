import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader
} from "@x402/core/http";
import { PaymentRequiredV2Schema, type PaymentRequiredV2 } from "@x402/core/schemas";
import { type PaymentRequired } from "@x402/core/types";

import { LumenError, type AppConfig } from "@lumenbazaar/shared";

import {
  type ExactStellarPaymentPayload,
  type ExactStellarPaymentRequirements,
  parseVerifyPaymentRequest
} from "./paymentPayload.js";

export const paymentRequiredHeader = "PAYMENT-REQUIRED";
export const paymentSignatureHeader = "PAYMENT-SIGNATURE";

export function encodePaymentRequiredV2(paymentRequired: PaymentRequiredV2) {
  return encodePaymentRequiredHeader(paymentRequired as PaymentRequired);
}

export function decodePaymentRequiredV2(header: string): PaymentRequiredV2 {
  try {
    const decoded = decodePaymentRequiredHeader(header);
    const parsed = PaymentRequiredV2Schema.safeParse(decoded);
    if (!parsed.success) {
      throw new Error("decoded requirements are not x402 v2");
    }
    return parsed.data;
  } catch (error) {
    throw malformedHeader(paymentRequiredHeader, error);
  }
}

export function encodePaymentSignatureV2(paymentPayload: ExactStellarPaymentPayload) {
  return encodePaymentSignatureHeader(paymentPayload);
}

export function decodePaymentSignatureV2(
  header: string,
  paymentRequirements: ExactStellarPaymentRequirements,
  config: AppConfig
) {
  try {
    const paymentPayload = decodePaymentSignatureHeader(header);
    return parseVerifyPaymentRequest(
      { x402Version: 2, paymentPayload, paymentRequirements },
      config
    ).paymentPayload;
  } catch (error) {
    if (error instanceof LumenError) {
      throw error;
    }
    throw malformedHeader(paymentSignatureHeader, error);
  }
}

function malformedHeader(header: string, error: unknown) {
  return new LumenError("INVALID_PAYMENT_PAYLOAD", `${header} is not valid base64 x402 JSON.`, {
    details: {
      header,
      officialContext: error instanceof Error ? error.message : String(error),
      requiredVersion: 2
    }
  });
}
