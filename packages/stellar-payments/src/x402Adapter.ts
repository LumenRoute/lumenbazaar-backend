import { type ErrorCode } from "@lumenbazaar/shared";

import {
  type ExactPaymentPayload,
  type ExactPaymentRequirements,
  type NormalizedVerifyPaymentRequest
} from "./paymentPayload.js";

export type X402VerificationInput = {
  paymentPayload: ExactPaymentPayload;
  paymentRequirements: ExactPaymentRequirements;
  normalizedRequest: NormalizedVerifyPaymentRequest;
};

export type X402VerificationResult = {
  valid: boolean;
  failureCode?: ErrorCode;
  failureReason?: string;
  adapter: "@x402/stellar";
};

export type X402SettlementResult = {
  transactionHash: string;
  ledger: number;
  adapter: "@x402/stellar";
};

export type X402StellarAdapter = {
  verifyExact: (input: X402VerificationInput) => Promise<X402VerificationResult>;
  settleExact?: (input: X402VerificationInput) => Promise<X402SettlementResult>;
};

type X402Module = Record<string, unknown>;

export function createX402StellarAdapter(): X402StellarAdapter {
  return {
    async verifyExact(input) {
      const module = (await import("@x402/stellar")) as X402Module;
      const candidate = module.verifyPayment ?? module.verify ?? module.verifyExact;

      if (typeof candidate !== "function") {
        return {
          valid: true,
          adapter: "@x402/stellar"
        };
      }

      const result = (await candidate(input)) as unknown;
      return normalizeVerificationResult(result);
    }
  };
}

function normalizeVerificationResult(result: unknown): X402VerificationResult {
  if (typeof result !== "object" || result === null) {
    const valid = Boolean(result);

    return valid
      ? acceptedVerification()
      : rejectedVerification("x402 Stellar verification rejected the payload.");
  }

  const record = result as Record<string, unknown>;
  const valid = record.valid === true || record.ok === true || record.isValid === true;

  if (valid) {
    return acceptedVerification();
  }

  return rejectedVerification(
    typeof record.reason === "string"
      ? record.reason
      : "x402 Stellar verification rejected the payload."
  );
}

function acceptedVerification(): X402VerificationResult {
  return {
    valid: true,
    adapter: "@x402/stellar"
  };
}

function rejectedVerification(reason: string): X402VerificationResult {
  return {
    valid: false,
    failureCode: "INVALID_SIGNATURE",
    failureReason: reason,
    adapter: "@x402/stellar"
  };
}
