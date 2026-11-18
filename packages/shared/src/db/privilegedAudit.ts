import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getCorrelationId } from "../correlation.js";

export type MutationActor = {
  actorId: string;
  actorType: "seller" | "system";
  reason: "resource.update" | "resource.status_change" | "resource.rollback";
};
export async function appendPrivilegedAudit(
  tx: Prisma.TransactionClient,
  action: string,
  targetId: string,
  actor: MutationActor
) {
  // Serialize chain extension and hold the lock until the business transaction commits.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(728194107)`;
  const previous = await tx.privilegedMutationAudit.findFirst({ orderBy: { sequence: "desc" } });
  const data = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    actorId: actor.actorId,
    actorType: actor.actorType,
    action,
    targetId,
    targetType: "resource",
    // Store an explicit reason code, never arbitrary mutation input or credentials.
    reason: actor.reason,
    correlationId: getCorrelationId() ?? randomUUID(),
    outcome: "success",
    previousHash: previous?.recordHash ?? "GENESIS"
  };
  const recordHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return tx.privilegedMutationAudit.create({ data: { ...data, recordHash } });
}
