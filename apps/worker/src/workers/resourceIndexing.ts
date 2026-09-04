import { type Job } from "bullmq";

import { getPrismaClient } from "@lumenbazaar/shared";

export type ResourceIndexingJobData = {
  resourceId: string;
  versionId: string;
};

/**
 * Resource Indexing Worker
 * Processes resources to build search documents and metadata indexes
 */
export async function handleResourceIndexing(job: Job<ResourceIndexingJobData>) {
  const { resourceId, versionId } = job.data;

  try {
    const db = getPrismaClient();

    // Get the resource
    const resource = await db.resource.findUnique({
      where: { id: resourceId }
    });

    if (!resource) {
      throw new Error(`Resource not found: ${resourceId}`);
    }

    // Build search document
    const body = buildSearchBody(resource);
    const ranking = buildRankingFields(resource);

    // Create or update SearchDocument in database
    await db.searchDocument.upsert({
      where: { resourceId },
      create: {
        resourceId,
        sellerId: resource.sellerId,
        body,
        ranking: ranking as never,
        indexedAt: new Date(),
        stale: false
      },
      update: {
        body,
        ranking: ranking as never,
        indexedAt: new Date(),
        stale: false
      }
    });

    // Record indexing success in catalog event
    const catalogData: {
      resourceId: string;
      sellerId: string;
      type: string;
      status: string;
      reason: null;
      metadata: Record<string, unknown>;
    } = {
      resourceId,
      sellerId: resource.sellerId,
      type: "indexed",
      status: "success",
      reason: null,
      metadata: {
        versionId,
        indexedAt: new Date().toISOString()
      }
    };

    await db.catalogEvent.create({
      data: catalogData as Parameters<typeof db.catalogEvent.create>[0]["data"]
    });

    job.log(`Resource ${resourceId} indexed successfully`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    job.log(`Resource indexing failed: ${errorMsg}`);

    // Record indexing failure
    try {
      const db = getPrismaClient();
      const failureData: {
        resourceId?: string;
        sellerId?: string;
        type: string;
        status: string;
        reason: string;
        metadata: Record<string, unknown>;
      } = {
        type: "indexing",
        status: "failed",
        reason: errorMsg,
        metadata: {
          versionId: job.data.versionId,
          error: errorMsg
        }
      };

      if (job.data.resourceId) {
        failureData.resourceId = job.data.resourceId;
      }

      await db.catalogEvent.create({
        data: failureData as Parameters<typeof db.catalogEvent.create>[0]["data"]
      });
    } catch {
      job.log(`Failed to record indexing failure event`);
    }

    // Re-throw to trigger retry
    throw err;
  }
}

function buildSearchBody(resource: {
  name: string;
  description: string;
  type: string;
  network: string;
  assetCode: string;
  routeTemplate: string;
  inputSchema: unknown;
  outputSchema: unknown;
  extensions: unknown;
}): string {
  return [
    resource.name,
    resource.description,
    resource.type,
    resource.network,
    resource.assetCode,
    resource.routeTemplate,
    JSON.stringify(resource.inputSchema || {}),
    JSON.stringify(resource.outputSchema || {}),
    JSON.stringify(resource.extensions || {})
  ]
    .join(" ")
    .toLowerCase();
}

function buildRankingFields(resource: {
  inputSchema: unknown;
  outputSchema: unknown;
  type: string;
  network: string;
  assetCode: string;
  extensions: unknown;
}): Record<string, unknown> {
  const inputSchema = (resource.inputSchema as Record<string, unknown>) || {};
  const outputSchema = (resource.outputSchema as Record<string, unknown>) || {};
  const extensions = (resource.extensions as Record<string, unknown>) || {};

  return {
    metadataQuality: schemaQuality(inputSchema, outputSchema),
    resourceType: resource.type,
    network: resource.network,
    asset: resource.assetCode,
    sellerVerified: extensions.trusted === true,
    historicalUptime: 1,
    recentSettlementSuccess: 1
  };
}

function schemaQuality(
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>
) {
  const inputProperties = countProperties(inputSchema);
  const outputProperties = countProperties(outputSchema);

  return (
    inputProperties +
    outputProperties +
    (inputSchema.type === "object" ? 1 : 0) +
    (outputSchema.type === "object" ? 1 : 0)
  );
}

function countProperties(schema: Record<string, unknown>) {
  const properties = schema.properties;

  return typeof properties === "object" && properties !== null && !Array.isArray(properties)
    ? Object.keys(properties as Record<string, unknown>).length
    : 0;
}
