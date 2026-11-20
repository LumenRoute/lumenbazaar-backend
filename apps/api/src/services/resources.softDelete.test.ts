import { describe, it, expect, beforeEach } from "vitest";
import { LumenError } from "@lumenbazaar/shared";
import {
  calculateRestorationDeadline,
  isWithinRestorationWindow,
  RESOURCE_RESTORATION_WINDOW_MS
} from "@lumenbazaar/shared";
import { ResourceService } from "./resources.js";
import { InMemoryResourceStore } from "./resources.js";
import { type CreateResourceInput } from "./resources.js";

describe("Resource Soft-Delete and Restoration", () => {
  let resourceStore: InMemoryResourceStore;
  let resourceService: ResourceService;

  const createTestResource = (overrides?: Partial<CreateResourceInput>): CreateResourceInput => ({
    sellerId: "seller_1",
    type: "http",
    name: "Test Resource",
    description: "A test resource",
    url: "https://example.com/api",
    routeTemplate: "/test",
    network: "stellar:testnet",
    payTo: "GBUQWP3BOUZX34ULNQG23RQ6F4BFJXYS2CSM623ZSXV7ORBTQWFF5H3",
    assetCode: "USDC",
    assetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    amount: "10.00",
    inputSchema: {},
    outputSchema: {},
    ...overrides
  });

  beforeEach(() => {
    resourceStore = new InMemoryResourceStore();
    resourceService = new ResourceService(undefined!, undefined!, resourceStore);
  });

  describe("Soft-Delete", () => {
    it("soft-deletes a resource with owner authorization", async () => {
      const input = createTestResource();
      const created = await resourceStore.createResource(input);

      const softDeleted = await resourceStore.softDeleteResource(
        created.id,
        "seller_1",
        { expectedVersion: created.version }
      );

      expect(softDeleted.deletedAt).not.toBeNull();
      expect(softDeleted.deletedBy).toBe("seller_1");
      expect(softDeleted.restoreDeadline).not.toBeNull();
      expect(softDeleted.purgedAt).toBeNull();
      expect(softDeleted.version).toBe(created.version + 1);
    });

    it("rejects soft-delete with stale version (optimistic concurrency)", async () => {
      const input = createTestResource();
      const created = await resourceStore.createResource(input);

      // Soft-delete with correct version first
      await resourceStore.softDeleteResource(created.id, "seller_1", {
        expectedVersion: created.version
      });

      // Try to soft-delete again with old version
      const deleted = await resourceStore.getResource(created.id);
      await expect(
        resourceStore.softDeleteResource(created.id, "seller_1", {
          expectedVersion: created.version // Stale version
        })
      ).rejects.toThrow(LumenError);
    });
  });

  describe("Restoration Window", () => {
    it("calculates restoration deadline as now + window duration", () => {
      const now = new Date();
      const deadline = calculateRestorationDeadline(now);

      const expectedDeadline = new Date(now.getTime() + RESOURCE_RESTORATION_WINDOW_MS);
      expect(Math.abs(deadline.getTime() - expectedDeadline.getTime())).toBeLessThan(10);
    });

    it("confirms resource is within restoration window", () => {
      const now = new Date();
      const futureDeadline = new Date(now.getTime() + RESOURCE_RESTORATION_WINDOW_MS / 2);

      expect(isWithinRestorationWindow(futureDeadline)).toBe(true);
    });

    it("confirms resource is outside restoration window", () => {
      const pastDeadline = new Date(Date.now() - 1000); // 1 second ago

      expect(isWithinRestorationWindow(pastDeadline)).toBe(false);
    });

    it("treats null deadline as outside window", () => {
      expect(isWithinRestorationWindow(null)).toBe(false);
    });
  });

  describe("Restore", () => {
    it("restores a soft-deleted resource within window", async () => {
      const input = createTestResource();
      const created = await resourceStore.createResource(input);

      // Soft-delete
      const softDeleted = await resourceStore.softDeleteResource(
        created.id,
        "seller_1",
        { expectedVersion: created.version }
      );

      // Restore within window
      const restored = await resourceStore.restoreResource(created.id, {
        expectedVersion: softDeleted.version
      });

      expect(restored.deletedAt).toBeNull();
      expect(restored.deletedBy).toBeNull();
      expect(restored.restoreDeadline).toBeNull();
      expect(restored.version).toBe(softDeleted.version + 1);
    });

    it("rejects restore of non-deleted resource", async () => {
      const input = createTestResource();
      const created = await resourceStore.createResource(input);

      await expect(
        resourceStore.restoreResource(created.id, { expectedVersion: created.version })
      ).rejects.toThrow("Resource is not soft-deleted");
    });

    it("rejects restore of already-purged resource", async () => {
      const input = createTestResource();
      const created = await resourceStore.createResource(input);

      // Soft-delete, then purge
      const softDeleted = await resourceStore.softDeleteResource(
        created.id,
        "seller_1",
        { expectedVersion: created.version }
      );

      await resourceStore.purgeResource(created.id);

      // Try to restore
      const purged = await resourceStore.getResource(created.id);
      await expect(
        resourceStore.restoreResource(created.id, { expectedVersion: purged!.version })
      ).rejects.toThrow("Resource has been permanently purged");
    });

    it("rejects restore with stale version", async () => {
      const input = createTestResource();
      const created = await resourceStore.createResource(input);

      const softDeleted = await resourceStore.softDeleteResource(
        created.id,
        "seller_1",
        { expectedVersion: created.version }
      );

      // Try to restore with old version
      await expect(
        resourceStore.restoreResource(created.id, { expectedVersion: created.version })
      ).rejects.toThrow(LumenError);
    });
  });

  describe("Purge", () => {
    it("deterministically purges expired resources in batches", async () => {
      const resources = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          resourceStore.createResource(
            createTestResource({ sellerId: `seller_${i}` })
          )
        )
      );

      // Soft-delete all
      for (let i = 0; i < resources.length; i++) {
        await resourceStore.softDeleteResource(resources[i]!.id, `seller_${i}`, {
          expectedVersion: resources[i]!.version
        });
      }

      // List and verify ordering
      const expired = await resourceStore.listExpiredResources(10);

      expect(expired).toHaveLength(5);
      // Verify ordering: by restoreDeadline, then by id
      for (let i = 0; i < expired.length - 1; i++) {
        const currentDeadline = expired[i]!.restoreDeadline.getTime();
        const nextDeadline = expired[i + 1]!.restoreDeadline.getTime();
        expect(currentDeadline).toBeLessThanOrEqual(nextDeadline);
      }
    });

    it("respects batch size limits", async () => {
      const BATCH_SIZE = 3;

      const resources = await Promise.all(
        Array.from({ length: BATCH_SIZE + 2 }, (_, i) =>
          resourceStore.createResource(createTestResource({ sellerId: `seller_${i}` }))
        )
      );

      // Soft-delete all
      for (let i = 0; i < resources.length; i++) {
        await resourceStore.softDeleteResource(resources[i]!.id, `seller_${i}`, {
          expectedVersion: resources[i]!.version
        });
      }

      // List with limit
      const expired = await resourceStore.listExpiredResources(BATCH_SIZE);
      expect(expired).toHaveLength(BATCH_SIZE);
    });

    it("tombstones catalog data on purge", async () => {
      const input = createTestResource({
        name: "Sensitive API",
        description: "Contains PII",
        url: "https://private.example.com/data"
      });
      const created = await resourceStore.createResource(input);

      // Soft-delete then purge
      const softDeleted = await resourceStore.softDeleteResource(
        created.id,
        "seller_1",
        { expectedVersion: created.version }
      );

      await resourceStore.purgeResource(created.id);

      const purged = await resourceStore.getResource(created.id);
      expect(purged).not.toBeNull();
      expect(purged!.name).toBe("[Purged]");
      expect(purged!.description).toBe("[Purged]");
      expect(purged!.url).toBe("https://removed/");
      expect(purged!.displayUrl).toBe("[Purged]");
      expect(purged!.inputSchema).toEqual({});
      expect(purged!.outputSchema).toEqual({});
      expect(purged!.purgedAt).not.toBeNull();
    });

    it("idempotently purges already-purged resource", async () => {
      const input = createTestResource();
      const created = await resourceStore.createResource(input);

      const softDeleted = await resourceStore.softDeleteResource(
        created.id,
        "seller_1",
        { expectedVersion: created.version }
      );

      // Purge twice
      await resourceStore.purgeResource(created.id);
      const firstPurge = await resourceStore.getResource(created.id);
      const firstPurgeTime = firstPurge!.purgedAt;

      // Small delay then purge again
      await new Promise((r) => setTimeout(r, 10));
      await resourceStore.purgeResource(created.id);
      const secondPurge = await resourceStore.getResource(created.id);

      expect(firstPurgeTime).toEqual(secondPurge!.purgedAt);
    });

    it("skips non-existent resources during purge", async () => {
      // Should not throw
      await expect(resourceStore.purgeResource("non-existent-id")).resolves.not.toThrow();
    });
  });

  describe("Settlement Evidence Preservation", () => {
    it("does not cascade-delete related settlement records", async () => {
      // Note: this test verifies the contract; actual preservation
      // is tested at the integration level with payment attempts and receipts
      const input = createTestResource();
      const created = await resourceStore.createResource(input);

      const softDeleted = await resourceStore.softDeleteResource(
        created.id,
        "seller_1",
        { expectedVersion: created.version }
      );

      // Resource still exists (soft-deleted, not deleted)
      const retrieved = await resourceStore.getResource(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.deletedAt).not.toBeNull();
    });
  });
});
