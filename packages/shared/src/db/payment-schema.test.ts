import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/0002_payment_records/migration.sql", "utf8");

describe("payment database schema", () => {
  it.each(["PaymentAttempt", "Settlement", "Receipt"])("defines the %s model", (model) => {
    expect(schema).toContain(`model ${model}`);
    expect(migration).toContain(`CREATE TABLE "${model}"`);
  });

  it("enforces replay and settlement uniqueness", () => {
    expect(schema).toContain("paymentHash     String      @unique");
    expect(schema).toContain("paymentAttemptId String         @unique");
    expect(migration).toContain('"PaymentAttempt_paymentHash_key"');
    expect(migration).toContain('"Settlement_paymentAttemptId_key"');
  });

  it("indexes payment state by network, seller, resource, and status", () => {
    expect(schema).toContain("@@index([network, status])");
    expect(schema).toContain("@@index([sellerId, status])");
    expect(schema).toContain("@@index([resourceId, status])");
  });
});
