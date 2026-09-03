import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/0003_discovery_operations/migration.sql", "utf8");

describe("discovery and operations database schema", () => {
  it.each([
    "CatalogEvent",
    "McpServer",
    "McpTool",
    "SearchDocument",
    "ConformanceRun",
    "NetworkStatus",
    "ApiClient",
    "RateLimitEvent",
    "AuditLog",
    "OperatorConfig"
  ])("defines the %s model", (model) => {
    expect(schema).toContain(`model ${model}`);
    expect(migration).toContain(`CREATE TABLE "${model}"`);
  });

  it("keeps discovery, search, and operator indexes", () => {
    expect(migration).toContain('"SearchDocument_body_fts_idx"');
    expect(schema).toContain("@@unique([serverId, name])");
    expect(schema).toContain("network        String   @unique");
    expect(schema).toContain("key       String   @unique");
  });
});
