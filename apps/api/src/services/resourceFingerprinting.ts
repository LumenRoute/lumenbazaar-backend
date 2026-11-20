import { randomUUID } from "node:crypto";

import { LumenError, type JsonObject } from "@lumenbazaar/shared";
import {
  computeResourceFingerprint,
  fingerprintsMatch,
  type ResourceFingerprint,
  type ResourceFingerprintInputs
} from "@lumenbazaar/shared";
import { type PrismaClient } from "@prisma/client";

export type ResourceFingerprintService = {
  /**
   * Compute and store a fingerprint for a resource.
   * If a collision is detected, flag it for moderation review.
   */
  registerResourceFingerprint: (input: {
    resourceId: string;
    sellerId: string;
    url: string;
    network: string;
    assetCode: string;
    assetIssuer: string;
    amount: string;
    payTo: string;
  }) => Promise<{ fingerprint: ResourceFingerprint; collisions: string[] }>;

  /**
   * Retrieve the fingerprint for a resource.
   */
  getResourceFingerprint: (resourceId: string) => Promise<ResourceFingerprint | null>;

  /**
   * Find all resources with the same fingerprint hash (potential duplicates).
   * This is used for collision detection and moderation queries.
   */
  findResourcesByFingerprintHash: (hash: string) => Promise<string[]>;

  /**
   * Flag a resource as a potential duplicate and create a moderation review task.
   * Returns the flag ID.
   */
  flagResourceAsDepicated: (input: {
    resourceId: string;
    collidingResourceIds: string[];
    fingerprintHash: string;
    fingerprintVersion: number;
    severity?: "high" | "medium" | "low";
  }) => Promise<string>;

  /**
   * List pending duplicate flags for moderation review.
   */
  listPendingDuplicateFlags: (
    filters?: { sellerId?: string; limit?: number; offset?: number }
  ) => Promise<Array<{ id: string; resourceId: string; collidingResourceIds: string[] }>>;

  /**
   * Update a duplicate flag status (reviewed, dismissed, or resolved).
   */
  updateDuplicateFlagStatus: (input: {
    flagId: string;
    status: "reviewed" | "dismissed" | "resolved";
    reviewedBy: string;
    resolution: string;
  }) => Promise<void>;
};

export class PrismaResourceFingerprintService implements ResourceFingerprintService {
  constructor(private readonly db: PrismaClient) {}

  async registerResourceFingerprint(input: {
    resourceId: string;
    sellerId: string;
    url: string;
    network: string;
    assetCode: string;
    assetIssuer: string;
    amount: string;
    payTo: string;
  }): Promise<{ fingerprint: ResourceFingerprint; collisions: string[] }> {
    const fingerprintInputs: ResourceFingerprintInputs = {
      sellerId: input.sellerId,
      url: input.url,
      network: input.network,
      assetCode: input.assetCode,
      assetIssuer: input.assetIssuer,
      amount: input.amount,
      payTo: input.payTo
    };

    const fingerprint = computeResourceFingerprint(fingerprintInputs);

    // Store the fingerprint
    await this.db.resourceFingerprint.upsert({
      where: { resourceId: input.resourceId },
      create: {
        id: `fp_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        resourceId: input.resourceId,
        version: fingerprint.version,
        hash: fingerprint.hash
      },
      update: {
        version: fingerprint.version,
        hash: fingerprint.hash
      }
    });

    // Search for collisions: other resources with the same fingerprint hash
    const collisions = await this.findResourcesByFingerprintHash(fingerprint.hash);

    // Filter out the current resource and the requesting seller's other resources
    const externalCollisions = collisions.filter((id) => id !== input.resourceId);

    // Flag collisions for moderation if any exist
    if (externalCollisions.length > 0) {
      const flagId = `dup_flag_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      await this.db.resourceDuplicateFlag.create({
        data: {
          id: flagId,
          resourceId: input.resourceId,
          collidingResourceIds: JSON.stringify(externalCollisions),
          fingerprintHash: fingerprint.hash,
          fingerprintVersion: fingerprint.version,
          severity: "high"
        }
      });
    }

    return { fingerprint, collisions: externalCollisions };
  }

  async getResourceFingerprint(resourceId: string): Promise<ResourceFingerprint | null> {
    const fp = await this.db.resourceFingerprint.findUnique({
      where: { resourceId }
    });

    if (!fp) {
      return null;
    }

    return {
      version: fp.version,
      hash: fp.hash
    };
  }

  async findResourcesByFingerprintHash(hash: string): Promise<string[]> {
    const fingerprints = await this.db.resourceFingerprint.findMany({
      where: { hash },
      select: { resourceId: true }
    });

    return fingerprints.map((fp) => fp.resourceId);
  }

  async flagResourceAsDepicated(input: {
    resourceId: string;
    collidingResourceIds: string[];
    fingerprintHash: string;
    fingerprintVersion: number;
    severity?: "high" | "medium" | "low";
  }): Promise<string> {
    const flagId = `dup_flag_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

    await this.db.resourceDuplicateFlag.create({
      data: {
        id: flagId,
        resourceId: input.resourceId,
        collidingResourceIds: JSON.stringify(input.collidingResourceIds),
        fingerprintHash: input.fingerprintHash,
        fingerprintVersion: input.fingerprintVersion,
        severity: input.severity ?? "high"
      }
    });

    return flagId;
  }

  async listPendingDuplicateFlags(
    filters?: { sellerId?: string; limit?: number; offset?: number }
  ): Promise<Array<{ id: string; resourceId: string; collidingResourceIds: string[] }>> {
    const limit = filters?.limit ?? 100;
    const offset = filters?.offset ?? 0;

    const flags = await this.db.resourceDuplicateFlag.findMany({
      where: {
        status: "pending",
        ...(filters?.sellerId ? { resource: { sellerId: filters.sellerId } } : {})
      },
      select: { id: true, resourceId: true, collidingResourceIds: true },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset
    });

    return flags.map((flag) => ({
      id: flag.id,
      resourceId: flag.resourceId,
      collidingResourceIds: JSON.parse(flag.collidingResourceIds) as string[]
    }));
  }

  async updateDuplicateFlagStatus(input: {
    flagId: string;
    status: "reviewed" | "dismissed" | "resolved";
    reviewedBy: string;
    resolution: string;
  }): Promise<void> {
    const flag = await this.db.resourceDuplicateFlag.findUnique({
      where: { id: input.flagId }
    });

    if (!flag) {
      throw new LumenError("NOT_FOUND", "Duplicate flag not found.");
    }

    await this.db.resourceDuplicateFlag.update({
      where: { id: input.flagId },
      data: {
        status: input.status,
        reviewedAt: new Date(),
        reviewedBy: input.reviewedBy,
        resolution: input.resolution
      }
    });
  }
}
