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

export type PaymentAuditLogger = {
  record: (input: {
    action: string;
    actorId?: string | null;
    actorType: "buyer" | "facilitator" | "seller" | "system";
    metadata?: Record<string, unknown>;
    targetId?: string | null;
    targetType: string;
  }) => Promise<unknown>;
};

export type PaymentVerificationServiceOptions = {
  auditLogService?: PaymentAuditLogger;
  adapter?: X402StellarAdapter;
  attemptStore?: PaymentAttemptStore;
};

export class PaymentVerificationService {
  private readonly auditLogService: PaymentAuditLogger | undefined;
  private readonly adapter: X402StellarAdapter;
  private readonly attemptStore: PaymentAttemptStore;

  constructor(
    private readonly config: AppConfig,
    options: PaymentVerificationServiceOptions = {}
  ) {
    this.adapter = options.adapter ?? createX402StellarAdapter();
    this.attemptStore = options.attemptStore ?? new InMemoryPaymentAttemptStore();
    this.auditLogService = options.auditLogService;
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

    await this.auditLogService?.record({
      action: "payment.verify",
      actorId: normalized.sellerId ?? null,
      actorType: "facilitator",
      targetId: attempt.id,
      targetType: "payment_attempt",
      metadata: {
        amount: attempt.amount,
        assetCode: attempt.assetCode,
        network: attempt.network,
        resourceId: attempt.resourceId,
        sellerId: attempt.sellerId,
        status: attempt.status
      }
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
