import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/0012_catalog_moderation/migration.sql", "utf8");

describe("catalog moderation database schema", () => {
  it.each(["ResourceModerationAction", "ModerationNotification"])(
    "defines the %s model in schema and migration",
    (model) => {
      expect(schema).toContain(`model ${model}`);
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }
  );

  it("persists quarantine state without deleting seller metadata", () => {
    expect(schema.match(/moderationState\s+String\s+@default\("visible"\)/gu)).toHaveLength(3);
    expect(migration).toContain('ADD COLUMN "moderationState" TEXT NOT NULL DEFAULT');
    expect(migration).not.toMatch(/DROP TABLE "(Resource|ResourceVersion|Receipt|Settlement)"/u);
  });

  it("enforces immutable moderation actions at the database layer", () => {
    expect(migration).toContain('CREATE TRIGGER "ResourceModerationAction_immutable"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "ResourceModerationAction"');
    expect(migration).toContain("RAISE EXCEPTION 'ResourceModerationAction records are immutable'");
  });
});
