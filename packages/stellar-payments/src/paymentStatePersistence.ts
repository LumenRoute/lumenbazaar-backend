import { type PaymentAttempt, type Receipt, type Settlement } from "@lumenbazaar/shared";

import { type CreateSettlementInput } from "./settlementStore.js";

export type ConfirmedPaymentStateInput = {
  attempt: PaymentAttempt;
  settlement: CreateSettlementInput & {
    transactionHash: string;
    ledger: number;
    settledAt: string;
    status: "confirmed";
  };
};

export type FailedPaymentStateInput = {
  attempt: PaymentAttempt;
  settlement: CreateSettlementInput & {
    status: "failed" | "timed_out";
  };
  failureCode: string;
  failureReason: string;
};

export type PaymentStatePersistence = {
  recordConfirmed(input: ConfirmedPaymentStateInput): Promise<{
    attempt: PaymentAttempt;
    settlement: Settlement;
    receipt: Receipt;
  }>;
  recordFailed(input: FailedPaymentStateInput): Promise<{
    attempt: PaymentAttempt;
    settlement: Settlement;
  }>;
};
