import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/0001_core_catalog/migration.sql", "utf8");

describe("core catalog database schema", () => {
  it.each([
    "Seller",
    "SellerDomain",
    "Resource",
    "ResourceVersion",
    "ResourceSchema",
    "PaymentRequirement"
  ])("defines the %s model", (model) => {
    expect(schema).toContain(`model ${model}`);
    expect(migration).toContain(`CREATE TABLE "${model}"`);
  });

  it("keeps uniqueness and indexes required for seller and resource lookups", () => {
    expect(schema).toContain("@@unique([sellerId, domain])");
    expect(schema).toContain("@@unique([resourceId, version])");
    expect(schema).toContain("@@index([network, assetCode])");
    expect(schema).toContain("@@index([type, status])");
  });
});
