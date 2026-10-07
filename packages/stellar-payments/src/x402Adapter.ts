import { type AppConfig, type ErrorCode } from "@lumenbazaar/shared";
import { type VerifyResponse } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/facilitator";

import { type FacilitatorSignerProvider } from "./facilitatorSigner.js";
import {
  type ExactStellarPaymentPayload,
  type ExactStellarPaymentRequirements,
  type NormalizedVerifyPaymentRequest
} from "./paymentPayload.js";

export type X402VerificationInput = {
  paymentPayload: ExactStellarPaymentPayload;
  paymentRequirements: ExactStellarPaymentRequirements;
  normalizedRequest: NormalizedVerifyPaymentRequest;
};

export type X402VerificationResult = {
  valid: boolean;
  failureCode?: ErrorCode;
  failureReason?: string;
  officialContext?: Record<string, unknown>;
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

type OfficialExactVerifier = {
  verify: (
    paymentPayload: ExactStellarPaymentPayload,
    paymentRequirements: ExactStellarPaymentRequirements
  ) => Promise<VerifyResponse>;
};

export type X402StellarAdapterOptions = {
  config: AppConfig;
  signerProvider: FacilitatorSignerProvider;
  createVerifier?: (input: {
    network: ExactStellarPaymentRequirements["network"];
    rpcUrl: string;
  }) => Promise<OfficialExactVerifier>;
};

export function createX402StellarAdapter(options?: X402StellarAdapterOptions): X402StellarAdapter {
  if (options !== undefined) {
    return createOfficialAdapter(options);
  }

  return {
    async verifyExact() {
      return rejectedVerification(
        "The exact Stellar facilitator adapter is not configured. Payment verification is unavailable.",
        "SETTLEMENT_FAILED"
      );
    }
  };
}

function createOfficialAdapter(options: X402StellarAdapterOptions): X402StellarAdapter {
  const createVerifier =
    options.createVerifier ??
    (async ({ rpcUrl }) => {
      const signer = await options.signerProvider.getSigner();
      return new ExactStellarScheme([signer], { rpcConfig: { url: rpcUrl } });
    });

  return {
    async verifyExact(input) {
      const network = options.config.networks[input.normalizedRequest.network];
      if (network === undefined) {
        return rejectedVerification("Payment network is not configured.", "UNSUPPORTED_NETWORK");
      }

      try {
        const verifier = await createVerifier({
          network: input.normalizedRequest.network,
          rpcUrl: network.rpcUrl
        });
        const response = await verifier.verify(input.paymentPayload, input.paymentRequirements);
        return mapOfficialVerification(response);
      } catch {
        return rejectedVerification(
          "Official Stellar verification is unavailable.",
          "SETTLEMENT_FAILED"
        );
      }
    }
  };
}

function mapOfficialVerification(response: VerifyResponse): X402VerificationResult {
  if (response.isValid === true && typeof response.payer === "string") {
    return { valid: true, adapter: "@x402/stellar" };
  }

  if (response.isValid !== false || typeof response.invalidReason !== "string") {
    return rejectedVerification(
      "Official Stellar verifier returned an incompatible response.",
      "SETTLEMENT_FAILED"
    );
  }

  const invalidReason = response.invalidReason;
  return rejectedVerification(failureMessage(invalidReason), failureCode(invalidReason), {
    invalidReason
  });
}

function failureCode(reason: string): ErrorCode {
  if (reason === "network_mismatch" || reason === "invalid_network") {
    return "UNSUPPORTED_NETWORK";
  }
  if (reason.includes("wrong_asset") || reason.includes("event_wrong_asset")) {
    return "ASSET_MISMATCH";
  }
  if (reason.includes("wrong_amount") || reason.includes("event_wrong_amount")) {
    return "AMOUNT_MISMATCH";
  }
  if (reason.includes("wrong_recipient") || reason.includes("event_wrong_to")) {
    return "RECIPIENT_MISMATCH";
  }
  if (reason.includes("expiration")) {
    return "AUTH_EXPIRED";
  }
  if (reason.includes("signature")) {
    return "INVALID_SIGNATURE";
  }
  if (reason === "unexpected_verify_error" || reason.includes("simulation_failed")) {
    return "SETTLEMENT_FAILED";
  }
  return "INVALID_PAYMENT_PAYLOAD";
}

function failureMessage(reason: string): string {
  const code = failureCode(reason);
  const messages: Record<ErrorCode, string> = {
    AMOUNT_MISMATCH: "Payment amount does not match the requirement.",
    ASSET_MISMATCH: "Payment asset does not match the requirement.",
    AUTH_EXPIRED: "Payment authorization expiry is invalid.",
    CATALOG_VALIDATION_FAILED: "Payment payload is invalid.",
    INTERNAL_ERROR: "Payment payload is invalid.",
    INVALID_PAYMENT_PAYLOAD: "Official Stellar verification rejected the payment payload.",
    INVALID_SIGNATURE: "Payment authorization signature is invalid.",
    PAYMENT_REQUIRED: "Payment payload is invalid.",
    RATE_LIMITED: "Payment payload is invalid.",
    RECIPIENT_MISMATCH: "Payment recipient does not match the requirement.",
    REPLAY_DETECTED: "Payment payload is invalid.",
    RESOURCE_NOT_FOUND: "Payment payload is invalid.",
    ROUTE_TEMPLATE_INVALID: "Payment payload is invalid.",
    SELLER_DOMAIN_UNVERIFIED: "Payment payload is invalid.",
    SELLER_NOT_FOUND: "Payment payload is invalid.",
    SETTLEMENT_FAILED: "Official Stellar verification could not be completed.",
    TRUSTLINE_REQUIRED: "Payment payload is invalid.",
    UNSUPPORTED_ASSET: "Payment payload is invalid.",
    UNSUPPORTED_NETWORK: "Payment network is not supported.",
    VALIDATION_FAILED: "Payment payload is invalid."
  };
  return messages[code];
}

function rejectedVerification(
  reason: string,
  failureCode: ErrorCode = "INVALID_SIGNATURE",
  officialContext?: Record<string, unknown>
): X402VerificationResult {
  return {
    valid: false,
    failureCode,
    failureReason: reason,
    ...(officialContext === undefined ? {} : { officialContext }),
    adapter: "@x402/stellar"
  };
}
