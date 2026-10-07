import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { AuditLogService, PrismaAuditLogStore } from "./audit.js";

const databaseUrl = process.env.PAYMENT_PERSISTENCE_TEST_DATABASE_URL;
const describePostgres = databaseUrl === undefined ? describe.skip : describe;

describePostgres("durable audit evidence", () => {
  let client: PrismaClient | undefined;

  afterEach(async () => client?.$disconnect());

  it("survives a client restart with correlation and redaction intact", async () => {
    client = createClient();
    await client.auditLog.deleteMany({ where: { action: "phase23.audit.persistence" } });
    const service = new AuditLogService(new PrismaAuditLogStore(client));
    await service.record({
      action: "phase23.audit.persistence",
      actorType: "system",
      correlationId: "corr_phase23_restart",
      targetType: "readiness_check",
      metadata: { reason: "token=must-not-survive" }
    });

    await client.$disconnect();
    client = createClient();
    const restarted = new AuditLogService(new PrismaAuditLogStore(client));

    await expect(restarted.list()).resolves.toContainEqual(
      expect.objectContaining({
        action: "phase23.audit.persistence",
        correlationId: "corr_phase23_restart",
        metadata: { reason: "[redacted]" }
      })
    );
  });
});

function createClient() {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "postgresql://integration-test-is-disabled" } }
  });
}
