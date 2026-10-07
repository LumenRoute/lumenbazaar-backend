import { z } from "zod";
import { type SettleResponse } from "@x402/core/types";

import { LumenError, type AppConfig, type PaymentAttempt } from "@lumenbazaar/shared";

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
  x402Version: z.literal(2),
  paymentPayload: z.unknown(),
  paymentRequirements: z.unknown()
});

export type SettlementServiceOptions = {
  auditLogService?: PaymentAuditLogger;
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
  network: NormalizedVerifyPaymentRequest["network"];
  status: "confirmed";
  amount: string;
};

export type LumenSettleResponse = SettleResponse & {
  success: true;
  extra: {
    lumenbazaar: Omit<SettlementServiceResult, "amount" | "network">;
  };
};

export function toLumenSettleResponse(result: SettlementServiceResult): LumenSettleResponse {
  const { amount, network, ...projectResult } = result;
  return {
    success: true,
    transaction: result.transactionHash,
    network,
    amount,
    extra: {
      lumenbazaar: projectResult
    }
  };
}

export class SettlementService {
  private readonly auditLogService: PaymentAuditLogger | undefined;
  private readonly adapter: X402StellarAdapter;
  private readonly attemptStore: PaymentAttemptStore;
  private readonly settlementStore: SettlementStore;
  private readonly receiptService: ReceiptService;

  constructor(
    private readonly config: AppConfig,
    options: SettlementServiceOptions = {}
  ) {
    this.adapter = options.adapter ?? createX402StellarAdapter();
    this.auditLogService = options.auditLogService;
    this.attemptStore = options.attemptStore ?? new InMemoryPaymentAttemptStore();
    this.settlementStore = options.settlementStore ?? new InMemorySettlementStore();
    this.receiptService = options.receiptService ?? new ReceiptService();
  }

  async settle(input: unknown): Promise<SettlementServiceResult> {
    const parsedResult = settlePaymentRequestSchema.safeParse(input);
    if (!parsedResult.success) {
      throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Settlement request is not valid x402 v2.", {
        details: {
          requiredVersion: 2,
          issues: parsedResult.error.issues
        }
      });
    }
    const parsed = parsedResult.data;
    const normalized = parseVerifyPaymentRequest(
      {
        x402Version: parsed.x402Version,
        paymentPayload: parsed.paymentPayload,
        paymentRequirements: parsed.paymentRequirements
      },
      this.config
    );
    const paymentHash = computePaymentHash(normalized.paymentPayload);
    const attempt = await this.attemptStore.findPaymentAttemptByHash(paymentHash);

    if (attempt === undefined) {
      throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Payment attempt was not found.");
    }

    const existingSettlement = await this.settlementStore.getSettlementByAttempt(attempt.id);
    if (existingSettlement !== undefined) {
      throw new LumenError("REPLAY_DETECTED", "Payment attempt has already been settled.");
    }

    if (attempt.paymentHash !== paymentHash) {
      throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Payment payload does not match attempt.");
    }

    const verification = await this.adapter.verifyExact({
      paymentPayload: normalized.paymentPayload,
      paymentRequirements: normalized.paymentRequirements,
      normalizedRequest: normalized
    });
    if (!verification.valid) {
      throw new LumenError(
        verification.failureCode ?? "INVALID_SIGNATURE",
        verification.failureReason ?? "Fresh Stellar verification rejected the settlement.",
        {
          details: {
            stage: "simulation",
            ...(verification.officialContext ?? {})
          }
        }
      );
    }

    const adapterResult = await this.settleWithAdapter(normalized);
    if (
      adapterResult.status !== "confirmed" ||
      adapterResult.transactionHash === undefined ||
      adapterResult.ledger === undefined
    ) {
      return this.recordFailedSettlement(attempt, normalized, adapterResult);
    }

    const settledAt = new Date().toISOString();
    const settlement = await this.settlementStore.createSettlement({
      paymentAttemptId: attempt.id,
      transactionHash: adapterResult.transactionHash,
      ledger: adapterResult.ledger,
      network: normalized.network,
      amount: normalized.amount,
      assetCode: normalized.asset.code,
      assetIssuer: normalized.asset.issuer,
      status: "confirmed",
      settledAt
    });

    const confirmedAttempt = await this.attemptStore.updatePaymentAttempt(attempt.id, {
      status: "confirmed"
    });
    const receipt = await this.receiptService.finalizeSettlementReceipt(
      confirmedAttempt,
      settlement
    );

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

    return {
      settlementId: settlement.id,
      receiptId: receipt.id,
      transactionHash: adapterResult.transactionHash,
      ledger: adapterResult.ledger,
      network: normalized.network,
      status: "confirmed",
      amount: normalized.amount
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

  private async recordFailedSettlement(
    attempt: PaymentAttempt,
    normalized: NormalizedVerifyPaymentRequest,
    result: X402SettlementResult
  ): Promise<never> {
    const status = result.status === "timed_out" ? "timed_out" : "failed";
    await this.settlementStore.createSettlement({
      paymentAttemptId: attempt.id,
      ...(result.transactionHash === undefined ? {} : { transactionHash: result.transactionHash }),
      network: normalized.network,
      amount: normalized.amount,
      assetCode: normalized.asset.code,
      assetIssuer: normalized.asset.issuer,
      status
    });
    await this.attemptStore.updatePaymentAttempt(attempt.id, {
      status,
      failureCode: result.failureCode ?? "SETTLEMENT_FAILED",
      failureReason: result.failureReason ?? "Stellar settlement failed."
    });
    throw new LumenError(
      result.failureCode ?? "SETTLEMENT_FAILED",
      result.failureReason ?? "Stellar settlement failed.",
      {
        details: {
          status,
          ...(result.transactionHash === undefined
            ? {}
            : { transactionHash: result.transactionHash }),
          ...(result.officialContext ?? {})
        }
      }
    );
  }
}
