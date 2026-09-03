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
  adapter?: X402StellarAdapter;
  attemptStore?: PaymentAttemptStore;
  settlementStore?: SettlementStore;
  receiptService?: ReceiptService;
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
  private readonly adapter: X402StellarAdapter;
  private readonly attemptStore: PaymentAttemptStore;
  private readonly settlementStore: SettlementStore;
  private readonly receiptService: ReceiptService;

  constructor(
    private readonly config: AppConfig,
    options: SettlementServiceOptions = {}
  ) {
    this.adapter = options.adapter ?? createX402StellarAdapter();
    this.attemptStore = options.attemptStore ?? new InMemoryPaymentAttemptStore();
    this.settlementStore = options.settlementStore ?? new InMemorySettlementStore();
    this.receiptService = options.receiptService ?? new ReceiptService();
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
