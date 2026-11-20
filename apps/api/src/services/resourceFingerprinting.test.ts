import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaResourceFingerprintService } from "./resourceFingerprinting.js";
import { LumenError } from "@lumenbazaar/shared";

const mockDb = {
  resourceFingerprint: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn()
  },
  resourceDuplicateFlag: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn()
  }
};

describe("ResourceFingerprintService", () => {
  let service: PrismaResourceFingerprintService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrismaResourceFingerprintService(mockDb as any);
  });

  describe("registerResourceFingerprint", () => {
    it("stores fingerprint and returns it", async () => {
      const input = {
        resourceId: "resource_123",
        sellerId: "seller_123",
        url: "https://api.example.com/service",
        network: "stellar:testnet",
        assetCode: "USD",
        assetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2IXBI5VBLDF",
        amount: "10.0000000",
        payTo: "GCZST3XVCDTUJ76ZAV2HA72KYQP5ULVK2OJ5L3JWMNFXR26NXJZ7CUD"
      };

      mockDb.resourceFingerprint.findMany.mockResolvedValue([
        { resourceId: input.resourceId }
      ]);

      const result = await service.registerResourceFingerprint(input);

      expect(result.fingerprint.version).toBe(1);
      expect(typeof result.fingerprint.hash).toBe("string");
      expect(result.collisions).toEqual([]);

      expect(mockDb.resourceFingerprint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resourceId: input.resourceId },
          create: expect.objectContaining({
            resourceId: input.resourceId,
            version: 1
          })
        })
      );
    });

    it("detects collisions with existing resources", async () => {
      const input = {
        resourceId: "resource_new",
        sellerId: "seller_123",
        url: "https://api.example.com/service",
        network: "stellar:testnet",
        assetCode: "USD",
        assetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2IXBI5VBLDF",
        amount: "10.0000000",
        payTo: "GCZST3XVCDTUJ76ZAV2HA72KYQP5ULVK2OJ5L3JWMNFXR26NXJZ7CUD"
      };

      const collidingIds = ["resource_existing1", "resource_existing2"];

      mockDb.resourceFingerprint.findMany.mockResolvedValue(
        [input.resourceId, ...collidingIds].map((id) => ({ resourceId: id }))
      );

      mockDb.resourceDuplicateFlag.create.mockResolvedValue({
        id: "flag_123"
      });

      const result = await service.registerResourceFingerprint(input);

      expect(result.collisions).toEqual(collidingIds);
      expect(mockDb.resourceDuplicateFlag.create).toHaveBeenCalled();
    });

    it("flags duplicate with high severity", async () => {
      const input = {
        resourceId: "resource_new",
        sellerId: "seller_123",
        url: "https://api.example.com/service",
        network: "stellar:testnet",
        assetCode: "USD",
        assetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2IXBI5VBLDF",
        amount: "10.0000000",
        payTo: "GCZST3XVCDTUJ76ZAV2HA72KYQP5ULVK2OJ5L3JWMNFXR26NXJZ7CUD"
      };

      mockDb.resourceFingerprint.findMany.mockResolvedValue([
        { resourceId: input.resourceId },
        { resourceId: "resource_existing" }
      ]);

      mockDb.resourceDuplicateFlag.create.mockResolvedValue({
        id: "flag_123"
      });

      await service.registerResourceFingerprint(input);

      expect(mockDb.resourceDuplicateFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: "high"
          })
        })
      );
    });
  });

  describe("getResourceFingerprint", () => {
    it("returns fingerprint when it exists", async () => {
      const resourceId = "resource_123";
      const storedFp = {
        resourceId,
        version: 1,
        hash: "abc123def456"
      };

      mockDb.resourceFingerprint.findUnique.mockResolvedValue(storedFp);

      const result = await service.getResourceFingerprint(resourceId);

      expect(result).toEqual({
        version: 1,
        hash: "abc123def456"
      });
    });

    it("returns null when fingerprint does not exist", async () => {
      mockDb.resourceFingerprint.findUnique.mockResolvedValue(null);

      const result = await service.getResourceFingerprint("resource_missing");

      expect(result).toBeNull();
    });
  });

  describe("findResourcesByFingerprintHash", () => {
    it("returns all resources with matching hash", async () => {
      const hash = "abc123def456";
      const resourceIds = ["resource_1", "resource_2", "resource_3"];

      mockDb.resourceFingerprint.findMany.mockResolvedValue(
        resourceIds.map((id) => ({ resourceId: id }))
      );

      const result = await service.findResourcesByFingerprintHash(hash);

      expect(result).toEqual(resourceIds);
      expect(mockDb.resourceFingerprint.findMany).toHaveBeenCalledWith({
        where: { hash },
        select: { resourceId: true }
      });
    });

    it("returns empty array when no matches found", async () => {
      mockDb.resourceFingerprint.findMany.mockResolvedValue([]);

      const result = await service.findResourcesByFingerprintHash("nonexistent_hash");

      expect(result).toEqual([]);
    });
  });

  describe("flagResourceAsDepicated", () => {
    it("creates a duplicate flag", async () => {
      const input = {
        resourceId: "resource_123",
        collidingResourceIds: ["resource_456", "resource_789"],
        fingerprintHash: "abc123def456",
        fingerprintVersion: 1,
        severity: "high" as const
      };

      mockDb.resourceDuplicateFlag.create.mockResolvedValue({
        id: "flag_123"
      });

      const flagId = await service.flagResourceAsDepicated(input);

      expect(flagId).toContain("dup_flag_");
      expect(mockDb.resourceDuplicateFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resourceId: input.resourceId,
            collidingResourceIds: JSON.stringify(input.collidingResourceIds),
            fingerprintHash: input.fingerprintHash,
            severity: "high"
          })
        })
      );
    });

    it("defaults to high severity when not specified", async () => {
      mockDb.resourceDuplicateFlag.create.mockResolvedValue({
        id: "flag_123"
      });

      await service.flagResourceAsDepicated({
        resourceId: "resource_123",
        collidingResourceIds: ["resource_456"],
        fingerprintHash: "abc123",
        fingerprintVersion: 1
      });

      expect(mockDb.resourceDuplicateFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: "high"
          })
        })
      );
    });
  });

  describe("listPendingDuplicateFlags", () => {
    it("lists pending flags with default pagination", async () => {
      const flags = [
        {
          id: "flag_1",
          resourceId: "resource_1",
          collidingResourceIds: '["resource_2"]'
        },
        {
          id: "flag_2",
          resourceId: "resource_3",
          collidingResourceIds: '["resource_4", "resource_5"]'
        }
      ];

      mockDb.resourceDuplicateFlag.findMany.mockResolvedValue(flags);

      const result = await service.listPendingDuplicateFlags();

      expect(result).toEqual([
        { id: "flag_1", resourceId: "resource_1", collidingResourceIds: ["resource_2"] },
        { id: "flag_2", resourceId: "resource_3", collidingResourceIds: ["resource_4", "resource_5"] }
      ]);

      expect(mockDb.resourceDuplicateFlag.findMany).toHaveBeenCalledWith({
        where: { status: "pending" },
        select: { id: true, resourceId: true, collidingResourceIds: true },
        orderBy: { createdAt: "desc" },
        take: 100,
        skip: 0
      });
    });

    it("filters by sellerId when provided", async () => {
      mockDb.resourceDuplicateFlag.findMany.mockResolvedValue([]);

      await service.listPendingDuplicateFlags({ sellerId: "seller_123" });

      expect(mockDb.resourceDuplicateFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resource: { sellerId: "seller_123" }
          })
        })
      );
    });

    it("respects limit and offset", async () => {
      mockDb.resourceDuplicateFlag.findMany.mockResolvedValue([]);

      await service.listPendingDuplicateFlags({ limit: 50, offset: 25 });

      expect(mockDb.resourceDuplicateFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          skip: 25
        })
      );
    });
  });

  describe("updateDuplicateFlagStatus", () => {
    it("updates flag status when flag exists", async () => {
      const flagId = "flag_123";

      mockDb.resourceDuplicateFlag.findUnique.mockResolvedValue({ id: flagId });
      mockDb.resourceDuplicateFlag.update.mockResolvedValue({});

      await service.updateDuplicateFlagStatus({
        flagId,
        status: "resolved",
        reviewedBy: "admin_123",
        resolution: "Duplicate resource deleted"
      });

      expect(mockDb.resourceDuplicateFlag.update).toHaveBeenCalledWith({
        where: { id: flagId },
        data: {
          status: "resolved",
          reviewedAt: expect.any(Date),
          reviewedBy: "admin_123",
          resolution: "Duplicate resource deleted"
        }
      });
    });

    it("throws NOT_FOUND when flag does not exist", async () => {
      mockDb.resourceDuplicateFlag.findUnique.mockResolvedValue(null);

      await expect(
        service.updateDuplicateFlagStatus({
          flagId: "nonexistent",
          status: "resolved",
          reviewedBy: "admin_123",
          resolution: "Test"
        })
      ).rejects.toThrow(LumenError);
    });

    it("supports dismissed status", async () => {
      const flagId = "flag_123";

      mockDb.resourceDuplicateFlag.findUnique.mockResolvedValue({ id: flagId });
      mockDb.resourceDuplicateFlag.update.mockResolvedValue({});

      await service.updateDuplicateFlagStatus({
        flagId,
        status: "dismissed",
        reviewedBy: "admin_123",
        resolution: "False positive: similar but distinct resources"
      });

      expect(mockDb.resourceDuplicateFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "dismissed"
          })
        })
      );
    });
  });
});
