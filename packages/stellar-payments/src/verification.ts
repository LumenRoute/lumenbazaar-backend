import { LumenError, type AppConfig } from "@lumenbazaar/shared";

import { computePaymentHash } from "./hash.js";
import {
  type NormalizedVerifyPaymentRequest,
  parseVerifyPaymentRequest
} from "./paymentPayload.js";
import {
  type X402StellarAdapter,
  type X402VerificationResult,
  createX402StellarAdapter
} from "./x402Adapter.js";

export type PaymentVerificationResult = {
  paymentAttemptId: string;
  paymentHash: string;
  network: NormalizedVerifyPaymentRequest["paymentPayload"]["network"];
  status: "verified";
  adapter: "@x402/stellar";
};

export type PaymentVerificationServiceOptions = {
  adapter?: X402StellarAdapter;
};

export class PaymentVerificationService {
  private readonly adapter: X402StellarAdapter;

  constructor(
    private readonly config: AppConfig,
    options: PaymentVerificationServiceOptions = {}
  ) {
    this.adapter = options.adapter ?? createX402StellarAdapter();
  }

  async verify(input: unknown): Promise<PaymentVerificationResult> {
    const normalized = parseVerifyPaymentRequest(input, this.config);
    const adapterResult = await this.adapter.verifyExact({
      paymentPayload: normalized.paymentPayload,
      paymentRequirements: normalized.paymentRequirements,
      normalizedRequest: normalized
    });

    assertAdapterAccepted(adapterResult);

    const paymentHash =
      normalized.paymentPayload.paymentHash ?? computePaymentHash(normalized.paymentPayload);

    return {
      paymentAttemptId: `pay_${paymentHash.slice(0, 24)}`,
      paymentHash,
      network: normalized.paymentPayload.network,
      status: "verified",
      adapter: adapterResult.adapter
    };
  }
}

function assertAdapterAccepted(result: X402VerificationResult) {
  if (result.valid) {
    return;
  }

  throw new LumenError(
    result.failureCode ?? "INVALID_SIGNATURE",
    result.failureReason ?? "x402 Stellar verification rejected the payload."
  );
}
