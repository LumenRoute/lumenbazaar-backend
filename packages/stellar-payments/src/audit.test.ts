import { describe, expect, it } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";
import { createTestPaymentRequest, testPaymentConfigEnv } from "@lumenbazaar/testkit";

import { InMemoryPaymentAttemptStore } from "./paymentAttemptStore.js";
import { SettlementService } from "./settlement.js";
import {
  PaymentVerificationService,
  type PaymentAuditLogger,
  type PaymentVerificationServiceOptions
} from "./verification.js";
import { type X402StellarAdapter } from "./x402Adapter.js";

describe("payment audit logging", () => {
  it("records verification and settlement audit events without sensitive payload fields", async () => {
    const records: Parameters<PaymentAuditLogger["record"]>[0][] = [];
    const auditLogService: PaymentAuditLogger = {
      async record(input) {
        records.push(input);
      }
    };
    const adapter: X402StellarAdapter = {
      async verifyExact() {
        return {
          valid: true,
          adapter: "@x402/stellar"
        };
      },
      async settleExact() {
        return {
          transactionHash: "tx_audit",
          ledger: 987,
          adapter: "@x402/stellar"
        };
      }
    };
    const config = loadConfig(testPaymentConfigEnv);
    const attemptStore = new InMemoryPaymentAttemptStore();
    const verificationOptions: PaymentVerificationServiceOptions = {
      adapter,
      attemptStore,
      auditLogService
    };
    const verificationService = new PaymentVerificationService(config, verificationOptions);
    const settlementService = new SettlementService(config, {
      adapter,
      attemptStore,
      auditLogService
    });
    const paymentRequest = exactPaymentRequest();
    await verificationService.verify(paymentRequest);

    await settlementService.settle(paymentRequest);

    expect(records.map((record) => record.action)).toEqual(["payment.verify", "payment.settle"]);
    expect(records[0]).toMatchObject({
      actorType: "facilitator",
      targetType: "payment_attempt",
      metadata: {
        amount: "500000",
        assetCode: "USDC",
        network: "stellar:testnet",
        status: "verified"
      }
    });
    expect(JSON.stringify(records)).not.toContain("secret-signature");
    expect(JSON.stringify(records)).not.toContain("paymentPayload");
    expect(records[1]).toMatchObject({
      targetType: "settlement",
      metadata: {
        receiptId: expect.stringMatching(/^receipt_/),
        transactionHash: "tx_audit",
        ledger: 987
      }
    });
  });
});

function exactPaymentRequest() {
  return createTestPaymentRequest("secret-signature");
}
