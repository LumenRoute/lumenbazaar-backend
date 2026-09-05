import { describe, expect, it } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";
import {
  InMemoryPaymentAttemptStore,
  PaymentVerificationService,
  SettlementService,
  type X402StellarAdapter
} from "@lumenbazaar/stellar-payments";

import { buildApiApp } from "../app.js";

describe("conformance routes", () => {
  it("creates, stores, and fetches exact conformance runs with reserved upto slots", async () => {
    const config = loadConfig({});
    const attemptStore = new InMemoryPaymentAttemptStore();
    const adapter: X402StellarAdapter = {
      async verifyExact() {
        return {
          valid: true,
          adapter: "@x402/stellar"
        };
      },
      async settleExact() {
        return {
          transactionHash: "tx_conformance",
          ledger: 789,
          adapter: "@x402/stellar"
        };
      }
    };
    const app = buildApiApp({
      logger: false,
      verificationService: new PaymentVerificationService(config, { adapter, attemptStore }),
      settlementService: new SettlementService(config, { adapter, attemptStore })
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/conformance/runs",
      payload: {
        network: "stellar:testnet"
      }
    });
    const runId = created.json().id as string;
    const listed = await app.inject({
      method: "GET",
      url: "/v1/conformance/runs?network=stellar:testnet"
    });
    const fetched = await app.inject({
      method: "GET",
      url: `/v1/conformance/runs/${runId}`
    });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      network: "stellar:testnet",
      suite: "stellar-x402",
      status: "passed",
      passedCount: 3,
      failedCount: 0,
      reservedCount: 3
    });
    expect(
      created.json().results.map((result: { id: string; status: string }) => ({
        id: result.id,
        status: result.status
      }))
    ).toEqual([
      { id: "exact-supported", status: "passed" },
      { id: "exact-verify", status: "passed" },
      { id: "exact-settle", status: "passed" },
      { id: "upto-supported", status: "reserved" },
      { id: "upto-session-create", status: "reserved" },
      { id: "upto-settle", status: "reserved" }
    ]);
    expect(listed.json()).toEqual([created.json()]);
    expect(fetched.json()).toEqual(created.json());

    await app.close();
  });
});
