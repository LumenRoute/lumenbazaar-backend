import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

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
    const config = loadConfig({});
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
    const verified = await verificationService.verify(paymentRequest);

    await settlementService.settle({
      paymentAttemptId: verified.paymentAttemptId,
      ...paymentRequest
    });

    expect(records.map((record) => record.action)).toEqual(["payment.verify", "payment.settle"]);
    expect(records[0]).toMatchObject({
      actorType: "facilitator",
      targetType: "payment_attempt",
      metadata: {
        amount: "0.05",
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
  return {
    paymentPayload: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo: localIssuerPublicKey,
      expiresAtLedger: 10,
      authorization: {
        signature: "secret-signature"
      },
      paymentHash: "audit_payment_hash"
    },
    paymentRequirements: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo: localIssuerPublicKey
    },
    currentLedger: 9
  };
}
