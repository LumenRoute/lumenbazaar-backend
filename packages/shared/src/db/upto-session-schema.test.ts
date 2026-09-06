import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/0004_upto_sessions/migration.sql", "utf8");

describe("upto session database schema", () => {
  it.each(["PaymentSession", "UptoSessionSettlement"])("defines the %s model", (model) => {
    expect(schema).toContain(`model ${model}`);
    expect(migration).toContain(`CREATE TABLE "${model}"`);
  });

  it("keeps session uniqueness and capped settlement indexes", () => {
    expect(schema).toContain("contractSessionId String                  @unique");
    expect(migration).toContain('"PaymentSession_contractSessionId_key"');
    expect(migration).toContain('"UptoSessionSettlement_transactionHash_key"');
    expect(schema).toContain("@@index([expiresAtLedger])");
  });
});
