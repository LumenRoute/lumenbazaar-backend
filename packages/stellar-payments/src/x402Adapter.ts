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

export function createX402StellarAdapter(): X402StellarAdapter {
  return {
    async verifyExact() {
      return rejectedVerification(
        "The exact Stellar facilitator adapter is not configured. Payment verification is unavailable.",
        "SETTLEMENT_FAILED"
      );
    }
  };
}

function rejectedVerification(
  reason: string,
  failureCode: ErrorCode = "INVALID_SIGNATURE"
): X402VerificationResult {
  return {
    valid: false,
    failureCode,
    failureReason: reason,
    adapter: "@x402/stellar"
  };
}
