import { describe, expect, it, vi } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";
import {
  InMemoryPaymentAttemptStore,
  PaymentVerificationService,
  SettlementService,
  type X402StellarAdapter
} from "@lumenbazaar/stellar-payments";

import { buildApiApp } from "../app.js";
import { type MetricsService } from "../services/metrics.js";

describe("facilitator metrics", () => {
  it("records verify and settle latency plus settlement success rate inputs", async () => {
    const metrics = fakeMetrics();
    const config = loadConfig({});
    const adapter: X402StellarAdapter = {
      async verifyExact() {
        return {
          valid: true,
          adapter: "@x402/stellar"
        };
      },
      async settleExact() {
        return {
          transactionHash: "tx_metrics",
          ledger: 654,
          adapter: "@x402/stellar"
        };
      }
    };
    const attemptStore = new InMemoryPaymentAttemptStore();
    const verificationService = new PaymentVerificationService(config, { adapter, attemptStore });
    const settlementService = new SettlementService(config, { adapter, attemptStore });
    const app = buildApiApp({
      logger: false,
      metricsService: metrics,
      verificationService,
      settlementService
    });
    const settleRequest = exactPaymentRequest("settle_metrics");
    const verified = await verificationService.verify(settleRequest);

    await app.inject({
      method: "POST",
      url: "/v1/verify",
      payload: exactPaymentRequest("verify_metrics")
    });
    await app.inject({
      method: "POST",
      url: "/v1/settle",
      payload: {
        paymentAttemptId: verified.paymentAttemptId,
        ...settleRequest
      }
    });

    expect(metrics.observeVerifyLatency).toHaveBeenCalledWith(
      "stellar:testnet",
      expect.any(Number)
    );
    expect(metrics.observeSettleLatency).toHaveBeenCalledWith(
      "stellar:testnet",
      expect.any(Number)
    );
    expect(metrics.recordSettlementResult).toHaveBeenCalledWith("stellar:testnet", "settled");
    expect(metrics.recordRpcError).not.toHaveBeenCalled();

    await app.close();
  });
});

function fakeMetrics(): MetricsService {
  return {
    collect: vi.fn(async () => ""),
    observeVerifyLatency: vi.fn(),
    observeSettleLatency: vi.fn(),
    observeSearchLatency: vi.fn(),
    recordRpcError: vi.fn(),
    recordSettlementResult: vi.fn(),
    setQueueDepth: vi.fn()
  };
}

function exactPaymentRequest(paymentHash: string) {
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
        signature: "sig"
      },
      paymentHash
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
