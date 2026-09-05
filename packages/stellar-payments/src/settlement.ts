import { type Queue } from "bullmq";
import { z } from "zod";

import { LumenError, type AppConfig } from "@lumenbazaar/shared";

import { computePaymentHash } from "./hash.js";
import {
  type NormalizedVerifyPaymentRequest,
  parseVerifyPaymentRequest
} from "./paymentPayload.js";
import { InMemoryPaymentAttemptStore, type PaymentAttemptStore } from "./paymentAttemptStore.js";
import { ReceiptService } from "./receipt.js";
import { InMemorySettlementStore, type SettlementStore } from "./settlementStore.js";
import { type PaymentAuditLogger } from "./verification.js";
import {
  type X402SettlementResult,
  type X402StellarAdapter,
  createX402StellarAdapter
} from "./x402Adapter.js";

export const settlePaymentRequestSchema = z.object({
  paymentAttemptId: z.string().min(1),
  paymentPayload: z.unknown(),
  paymentRequirements: z.unknown(),
  resourceId: z.string().optional(),
  sellerId: z.string().optional(),
  currentLedger: z.number().int().nonnegative().optional()
});

export type SettlementServiceOptions = {
  auditLogService?: PaymentAuditLogger;
  adapter?: X402StellarAdapter;
  attemptStore?: PaymentAttemptStore;
  settlementStore?: SettlementStore;
  receiptService?: ReceiptService;
  confirmationQueue?: Queue;
};

export type SettlementServiceResult = {
  settlementId: string;
  receiptId: string;
  transactionHash: string;
  ledger: number;
  network: NormalizedVerifyPaymentRequest["paymentPayload"]["network"];
  status: "settled";
};

export class SettlementService {
  private readonly auditLogService: PaymentAuditLogger | undefined;
  private readonly adapter: X402StellarAdapter;
  private readonly attemptStore: PaymentAttemptStore;
  private readonly settlementStore: SettlementStore;
  private readonly receiptService: ReceiptService;
  private readonly confirmationQueue: Queue | undefined;

  constructor(
    private readonly config: AppConfig,
    options: SettlementServiceOptions = {}
  ) {
    this.adapter = options.adapter ?? createX402StellarAdapter();
    this.auditLogService = options.auditLogService;
    this.attemptStore = options.attemptStore ?? new InMemoryPaymentAttemptStore();
    this.settlementStore = options.settlementStore ?? new InMemorySettlementStore();
    this.receiptService = options.receiptService ?? new ReceiptService();
    this.confirmationQueue = options.confirmationQueue;
  }

  async settle(input: unknown): Promise<SettlementServiceResult> {
    const parsed = settlePaymentRequestSchema.parse(input);
    const normalized = parseVerifyPaymentRequest(
      {
        paymentPayload: parsed.paymentPayload,
        paymentRequirements: parsed.paymentRequirements,
        ...(parsed.resourceId === undefined ? {} : { resourceId: parsed.resourceId }),
        ...(parsed.sellerId === undefined ? {} : { sellerId: parsed.sellerId }),
        ...(parsed.currentLedger === undefined ? {} : { currentLedger: parsed.currentLedger })
      },
      this.config
    );
    const attempt = await this.attemptStore.getPaymentAttempt(parsed.paymentAttemptId);

    if (attempt === undefined) {
      throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Payment attempt was not found.");
    }

    if (attempt.status === "settled") {
      throw new LumenError("REPLAY_DETECTED", "Payment attempt has already been settled.");
    }

    const paymentHash =
      normalized.paymentPayload.paymentHash ?? computePaymentHash(normalized.paymentPayload);

    if (attempt.paymentHash !== paymentHash) {
      throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Payment payload does not match attempt.");
    }

    const adapterResult = await this.settleWithAdapter(normalized);
    const settledAt = new Date().toISOString();
    const settlement = await this.settlementStore.createSettlement({
      paymentAttemptId: attempt.id,
      transactionHash: adapterResult.transactionHash,
      ledger: adapterResult.ledger,
      network: normalized.paymentPayload.network,
      amount: normalized.paymentPayload.amount,
      assetCode: normalized.paymentPayload.asset.code,
      assetIssuer: normalized.paymentPayload.asset.issuer,
      status: "settled",
      settledAt
    });

    await this.attemptStore.updatePaymentAttempt(attempt.id, { status: "settled" });
    const receipt = await this.receiptService.finalizeSettlementReceipt(attempt, settlement);

    await this.auditLogService?.record({
      action: "payment.settle",
      actorId: attempt.sellerId,
      actorType: "facilitator",
      targetId: settlement.id,
      targetType: "settlement",
      metadata: {
        amount: settlement.amount,
        assetCode: settlement.assetCode,
        ledger: settlement.ledger,
        network: settlement.network,
        paymentAttemptId: attempt.id,
        receiptId: receipt.id,
        resourceId: attempt.resourceId,
        status: settlement.status,
        transactionHash: settlement.transactionHash
      }
    });

    // Enqueue settlement confirmation job if queue is available
    if (this.confirmationQueue) {
      await this.confirmationQueue.add(
        "settlement-confirmation",
        {
          settlementId: settlement.id,
          transactionHash: adapterResult.transactionHash,
          network: normalized.paymentPayload.network,
          paymentAttemptId: attempt.id
        },
        {
          delay: 5000, // Wait 5 seconds before first check
          attempts: 30,
          backoff: {
            type: "exponential",
            delay: 5000
          },
          removeOnComplete: true,
          removeOnFail: false
        }
      );
    }

    return {
      settlementId: settlement.id,
      receiptId: receipt.id,
      transactionHash: adapterResult.transactionHash,
      ledger: adapterResult.ledger,
      network: normalized.paymentPayload.network,
      status: "settled"
    };
  }

  async getSettlementByTransactionHash(transactionHash: string) {
    return this.settlementStore.getSettlementByTransactionHash(transactionHash);
  }

  getReceiptService() {
    return this.receiptService;
  }

  private async settleWithAdapter(
    normalized: NormalizedVerifyPaymentRequest
  ): Promise<X402SettlementResult> {
    if (this.adapter.settleExact === undefined) {
      throw new LumenError(
        "SETTLEMENT_FAILED",
        "@x402/stellar settlement adapter is not available in this runtime."
      );
    }

    return this.adapter.settleExact({
      paymentPayload: normalized.paymentPayload,
      paymentRequirements: normalized.paymentRequirements,
      normalizedRequest: normalized
    });
  }
}
