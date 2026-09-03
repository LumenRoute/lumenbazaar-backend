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
import { InMemoryPaymentAttemptStore, type PaymentAttemptStore } from "./paymentAttemptStore.js";

export type PaymentVerificationResult = {
  paymentAttemptId: string;
  paymentHash: string;
  network: NormalizedVerifyPaymentRequest["paymentPayload"]["network"];
  status: "verified";
  adapter: "@x402/stellar";
};

export type PaymentVerificationServiceOptions = {
  adapter?: X402StellarAdapter;
  attemptStore?: PaymentAttemptStore;
};

export class PaymentVerificationService {
  private readonly adapter: X402StellarAdapter;
  private readonly attemptStore: PaymentAttemptStore;

  constructor(
    private readonly config: AppConfig,
    options: PaymentVerificationServiceOptions = {}
  ) {
    this.adapter = options.adapter ?? createX402StellarAdapter();
    this.attemptStore = options.attemptStore ?? new InMemoryPaymentAttemptStore();
  }

  async verify(input: unknown): Promise<PaymentVerificationResult> {
    const normalized = parseVerifyPaymentRequest(input, this.config);
    const paymentHash =
      normalized.paymentPayload.paymentHash ?? computePaymentHash(normalized.paymentPayload);

    if ((await this.attemptStore.findPaymentAttemptByHash(paymentHash)) !== undefined) {
      throw new LumenError("REPLAY_DETECTED", "Payment payload has already been used.");
    }

    const adapterResult = await this.adapter.verifyExact({
      paymentPayload: normalized.paymentPayload,
      paymentRequirements: normalized.paymentRequirements,
      normalizedRequest: normalized
    });

    assertAdapterAccepted(adapterResult);

    const attempt = await this.attemptStore.createVerifiedAttempt({
      paymentHash,
      network: normalized.paymentPayload.network,
      assetCode: normalized.paymentPayload.asset.code,
      assetIssuer: normalized.paymentPayload.asset.issuer,
      amount: normalized.paymentPayload.amount,
      payTo: normalized.paymentPayload.payTo,
      ...(normalized.resourceId === undefined ? {} : { resourceId: normalized.resourceId }),
      ...(normalized.sellerId === undefined ? {} : { sellerId: normalized.sellerId }),
      ...(normalized.paymentPayload.expiresAtLedger === undefined
        ? {}
        : { expiresAtLedger: normalized.paymentPayload.expiresAtLedger })
    });

    return {
      paymentAttemptId: attempt.id,
      paymentHash,
      network: normalized.paymentPayload.network,
      status: "verified",
      adapter: adapterResult.adapter
    };
  }

  getAttemptStore() {
    return this.attemptStore;
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
