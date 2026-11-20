import { Prisma, PrismaClient } from "@prisma/client";

import { LumenError, type PaymentAttempt } from "@lumenbazaar/shared";

import type {
  CreatePaymentAttemptInput,
  PaymentAttemptStore,
  UpdatePaymentAttemptInput
} from "./paymentAttemptStore.js";

/**
 * Prisma-backed payment attempt store with atomic duplicate detection.
 *
 * Key guarantees:
 * - Duplicate payment hashes rejected ATOMICALLY via unique constraint
 * - Concurrent verification results in exactly one winner
 * - Transactional state changes (no illegal transitions)
 * - Payment hashes normalized consistently before storage/comparison
 */
export class PrismaPaymentAttemptStore implements PaymentAttemptStore {
  constructor(private readonly db: PrismaClient) {}

  async createVerifiedAttempt(input: CreatePaymentAttemptInput): Promise<PaymentAttempt> {
    // Normalize payment hash consistently (lowercase, no padding)
    const normalizedHash = normalizePaymentHash(input.paymentHash);

    try {
      const attempt = await this.db.paymentAttempt.create({
        data: {
          correlationId: input.correlationId ?? generateCorrelationId(),
          resourceId: input.resourceId ?? null,
          sellerId: input.sellerId ?? null,
          paymentHash: normalizedHash,
          idempotencyKey: input.idempotencyKey ?? `verify:${normalizedHash}`,
          network: input.network,
          assetCode: input.assetCode.toUpperCase(),
          assetIssuer: input.assetIssuer.toUpperCase(),
          amount: input.amount,
          payTo: input.payTo,
          status: "verified",
          expiresAtLedger: input.expiresAtLedger ?? null
        }
      });

      return mapPaymentAttempt(attempt);
    } catch (error) {
      // Atomic duplicate detection via unique constraint violation
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new LumenError("REPLAY_DETECTED", "Payment payload has already been used.");
      }
      throw error;
    }
  }

  async getPaymentAttempt(paymentAttemptId: string): Promise<PaymentAttempt | undefined> {
    const attempt = await this.db.paymentAttempt.findUnique({
      where: { id: paymentAttemptId }
    });
    return attempt === null ? undefined : mapPaymentAttempt(attempt);
  }

  async findPaymentAttemptByHash(paymentHash: string): Promise<PaymentAttempt | undefined> {
    const normalizedHash = normalizePaymentHash(paymentHash);
    const attempt = await this.db.paymentAttempt.findUnique({
      where: { paymentHash: normalizedHash }
    });
    return attempt === null ? undefined : mapPaymentAttempt(attempt);
  }

  async claimSettlement(paymentAttemptId: string): Promise<PaymentAttempt | undefined> {
    // Transactional claim: only succeed if currently verified
    const attempt = await this.db.$transaction(async (tx) => {
      const current = await tx.paymentAttempt.findUnique({
        where: { id: paymentAttemptId }
      });

      if (current === null || current.status !== "verified") {
        return null;
      }

      // Atomic conditional update (guard against race conditions)
      const updated = await tx.paymentAttempt.updateMany({
        where: { id: paymentAttemptId, status: "verified" },
        data: { status: "settling" }
      });

      if (updated.count === 0) {
        return null; // Someone else claimed it first
      }

      // Return updated record
      return tx.paymentAttempt.findUnique({ where: { id: paymentAttemptId } });
    });

    return attempt === null ? undefined : mapPaymentAttempt(attempt);
  }

  async updatePaymentAttempt(
    paymentAttemptId: string,
    input: UpdatePaymentAttemptInput
  ): Promise<PaymentAttempt> {
    const attempt = await this.db.paymentAttempt.findUnique({
      where: { id: paymentAttemptId }
    });

    if (attempt === null) {
      throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Payment attempt was not found.");
    }

    // Transactional state update with guards
    const updated = await this.db.$transaction(async (tx) => {
      // Validate legal state transition
      if (input.status !== undefined && !isLegalStateTransition(attempt.status, input.status)) {
        throw new LumenError(
          "INVALID_STATE_TRANSITION",
          `Cannot transition from ${attempt.status} to ${input.status}`
        );
      }

      return tx.paymentAttempt.update({
        where: { id: paymentAttemptId },
        data: {
          status: input.status ?? attempt.status,
          failureCode: input.failureCode === undefined ? attempt.failureCode : input.failureCode,
          failureReason:
            input.failureReason === undefined ? attempt.failureReason : input.failureReason
        }
      });
    });

    return mapPaymentAttempt(updated);
  }
}

/**
 * Normalize payment hash for consistent storage and comparison.
 * Prevents variants like "abc123" and "ABC123" from bypassing uniqueness.
 */
function normalizePaymentHash(hash: string): string {
  return hash.toLowerCase().trim();
}

/**
 * Generate a correlation ID if not provided.
 * In real implementation, would use @lumenbazaar/shared helpers.
 */
function generateCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Validate state transitions to prevent illegal states.
 * Allowed transitions:
 * - received → verified (initial verification)
 * - verified → settling (settlement claim)
 * - settling → submitted (broadcast to network)
 * - submitted → confirmed (confirmation from ledger)
 * - confirmed → settled (final settlement)
 * - * → failed (terminal error state)
 * - * → expired (timeout state)
 * - * → timed_out (timeout state)
 */
function isLegalStateTransition(from: string, to: string): boolean {
  const legalTransitions: Record<string, Set<string>> = {
    received: new Set(["verified", "failed", "expired", "timed_out"]),
    verified: new Set(["settling", "failed", "expired", "timed_out"]),
    settling: new Set(["submitted", "failed", "expired", "timed_out"]),
    submitted: new Set(["confirmed", "failed", "timed_out"]),
    confirmed: new Set(["settled", "failed", "timed_out"]),
    settled: new Set([]),
    failed: new Set([]),
    expired: new Set([]),
    timed_out: new Set([])
  };

  return legalTransitions[from]?.has(to) ?? false;
}

/**
 * Map Prisma record to domain PaymentAttempt type.
 */
function mapPaymentAttempt(
  row: Prisma.PaymentAttemptGetPayload<object>
): PaymentAttempt {
  return {
    ...row,
    amount: row.amount.toString(),
    failureCode: (row.failureCode ?? null) as PaymentAttempt["failureCode"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
