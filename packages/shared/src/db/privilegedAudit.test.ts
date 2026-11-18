import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { appendPrivilegedAudit } from "./privilegedAudit.js";

it("locks chain extension and hashes only explicit audit evidence", async () => {
  const create = vi.fn(async (input: { data: Record<string, unknown> }) => input.data);
  const lock = vi.fn(async () => 1);
  const tx = {
    $executeRaw: lock,
    privilegedMutationAudit: { findFirst: async () => ({ recordHash: "prior" }), create }
  } as unknown as Prisma.TransactionClient;
  await appendPrivilegedAudit(tx, "resource.update", "resource-1", {
    actorId: "seller-1",
    actorType: "seller",
    reason: "resource.status_change"
  });
  expect(lock).toHaveBeenCalledOnce();
  const data = create.mock.calls[0]![0].data;
  const { recordHash, ...evidence } = data;
  expect(recordHash).toBe(createHash("sha256").update(JSON.stringify(evidence)).digest("hex"));
  expect(data).toMatchObject({
    previousHash: "prior",
    actorId: "seller-1",
    reason: "resource.status_change",
    outcome: "success"
  });
  expect(Object.keys(data)).not.toContain("metadata");
});
it("propagates failed audit writes to abort the enclosing transaction", async () => {
  const tx = {
    $executeRaw: async () => 1,
    privilegedMutationAudit: {
      findFirst: async () => null,
      create: async () => {
        throw new Error("audit unavailable");
      }
    }
  } as unknown as Prisma.TransactionClient;
  await expect(
    appendPrivilegedAudit(tx, "resource.rollback", "r", {
      actorId: "internal",
      actorType: "system",
      reason: "resource.rollback"
    })
  ).rejects.toThrow("audit unavailable");
});
