import { randomUUID } from "node:crypto";

import {
  LumenError,
  type ErrorCode,
  type NetworkId,
  type PaymentAttempt
} from "@lumenbazaar/shared";

export type CreatePaymentAttemptInput = {
  resourceId?: string;
  sellerId?: string;
  paymentHash: string;
  idempotencyKey?: string;
  network: NetworkId;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  payTo: string;
  expiresAtLedger?: number;
};

export type UpdatePaymentAttemptInput = {
  status?: PaymentAttempt["status"];
  failureCode?: ErrorCode | null;
  failureReason?: string | null;
};

export type PaymentAttemptStore = {
  createVerifiedAttempt: (input: CreatePaymentAttemptInput) => Promise<PaymentAttempt>;
  getPaymentAttempt: (paymentAttemptId: string) => Promise<PaymentAttempt | undefined>;
  findPaymentAttemptByHash: (paymentHash: string) => Promise<PaymentAttempt | undefined>;
  updatePaymentAttempt: (
    paymentAttemptId: string,
    input: UpdatePaymentAttemptInput
  ) => Promise<PaymentAttempt>;
};

export class InMemoryPaymentAttemptStore implements PaymentAttemptStore {
  private readonly attempts = new Map<string, PaymentAttempt>();
  private readonly hashes = new Map<string, string>();
  private readonly idempotencyKeys = new Map<string, string>();

  async createVerifiedAttempt(input: CreatePaymentAttemptInput) {
    const idempotencyKey = input.idempotencyKey ?? `verify:${input.paymentHash}`;
    if (this.hashes.has(input.paymentHash) || this.idempotencyKeys.has(idempotencyKey)) {
      throw new LumenError("REPLAY_DETECTED", "Payment payload has already been used.");
    }

    const now = new Date().toISOString();
    const id = `pay_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const attempt: PaymentAttempt = {
      id,
      resourceId: input.resourceId ?? null,
      sellerId: input.sellerId ?? null,
      paymentHash: input.paymentHash,
      idempotencyKey,
      network: input.network,
      assetCode: input.assetCode,
      assetIssuer: input.assetIssuer,
      amount: input.amount,
      payTo: input.payTo,
      status: "verified",
      failureCode: null,
      failureReason: null,
      expiresAtLedger: input.expiresAtLedger ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.attempts.set(id, attempt);
    this.hashes.set(input.paymentHash, id);
    this.idempotencyKeys.set(idempotencyKey, id);

    return attempt;
  }

  async getPaymentAttempt(paymentAttemptId: string) {
    return this.attempts.get(paymentAttemptId);
  }

  async findPaymentAttemptByHash(paymentHash: string) {
    const id = this.hashes.get(paymentHash);
    return id === undefined ? undefined : this.attempts.get(id);
  }

  async updatePaymentAttempt(paymentAttemptId: string, input: UpdatePaymentAttemptInput) {
    const attempt = this.attempts.get(paymentAttemptId);

    if (attempt === undefined) {
      throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Payment attempt was not found.");
    }

    const updated: PaymentAttempt = {
      ...attempt,
      status: input.status ?? attempt.status,
      failureCode: input.failureCode === undefined ? attempt.failureCode : input.failureCode,
      failureReason:
        input.failureReason === undefined ? attempt.failureReason : input.failureReason,
      updatedAt: new Date().toISOString()
    };

    this.attempts.set(paymentAttemptId, updated);
    return updated;
  }
}
