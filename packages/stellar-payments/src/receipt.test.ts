import { describe, expect, it } from "vitest";

import { type PaymentAttempt, type Settlement } from "@lumenbazaar/shared";

import { ReceiptService } from "./index.js";

const now = "2026-09-03T00:00:00.000Z";

const attempt: PaymentAttempt = {
  id: "pay_1",
  resourceId: "resource_1",
  sellerId: "seller_1",
  paymentHash: "hash_1",
  network: "stellar:testnet",
  assetCode: "USDC",
  assetIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  amount: "0.05",
  payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  status: "settled",
  failureCode: null,
  failureReason: null,
  expiresAtLedger: 100,
  createdAt: now,
  updatedAt: now
};

const settlement: Settlement = {
  id: "set_1",
  paymentAttemptId: "pay_1",
  transactionHash: "tx_1",
  ledger: 123,
  network: "stellar:testnet",
  amount: "0.05",
  assetCode: "USDC",
  assetIssuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  status: "settled",
  settledAt: now,
  createdAt: now
};

describe("ReceiptService", () => {
  it("finalizes a settlement receipt and makes it retrievable", async () => {
    const service = new ReceiptService();
    const receipt = await service.finalizeSettlementReceipt(attempt, settlement);

    expect(receipt).toMatchObject({
      paymentAttemptId: "pay_1",
      resourceId: "resource_1",
      sellerId: "seller_1",
      transactionHash: "tx_1",
      ledger: 123,
      status: "finalized"
    });
    await expect(service.getReceipt(receipt.id)).resolves.toEqual(receipt);
  });

  it("returns the same receipt when finalization is retried", async () => {
    const service = new ReceiptService();
    const first = await service.finalizeSettlementReceipt(attempt, settlement);
    const second = await service.finalizeSettlementReceipt(attempt, settlement);

    expect(second.id).toBe(first.id);
  });
});
