import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/0002_payment_records/migration.sql", "utf8");
const durabilityMigration = readFileSync(
  "prisma/migrations/0005_durable_payment_persistence/migration.sql",
  "utf8"
);
const rollbackGuide = readFileSync("docs/migrations/0005-durable-payment-persistence.md", "utf8");

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
    expect(schema).toContain("idempotencyKey  String      @unique");
    expect(schema).toContain("evidenceHash     String         @unique");
    expect(durabilityMigration).toContain('"PaymentAttempt_idempotencyKey_key"');
    expect(durabilityMigration).toContain('"Receipt_evidenceHash_key"');
    expect(durabilityMigration).toContain('REFERENCES "PaymentAttempt" ("id") ON DELETE RESTRICT');
  });

  it("tracks reconciliation state and documents a controlled rollback", () => {
    expect(schema).toContain('reconciliationState String         @default("not_required")');
    expect(durabilityMigration).toContain('ADD COLUMN "reconciliationState"');
    expect(rollbackGuide).toContain("Rollback");
    expect(rollbackGuide).toContain("financial evidence");
  });

  it("indexes payment state by network, seller, resource, and status", () => {
    expect(schema).toContain("@@index([network, status])");
    expect(schema).toContain("@@index([sellerId, status])");
    expect(schema).toContain("@@index([resourceId, status])");
  });
});
