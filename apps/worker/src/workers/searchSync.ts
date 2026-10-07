import { type Job } from "bullmq";

import { getPrismaClient, redactSensitiveText } from "@lumenbazaar/shared";

export type SearchSyncJobData = {
  action: "rebuild" | "mark_stale";
  resourceId?: string;
  network?: string;
};

/**
 * Search Sync Worker
 * Manages search document synchronization and rebuilding of search indexes
 */
export async function handleSearchSync(job: Job<SearchSyncJobData>) {
  const { action, resourceId, network } = job.data;

  try {
    const db = getPrismaClient();

    if (action === "rebuild") {
      job.log("Starting search index rebuild");

      // Get all resources that need indexing
      const where: Record<string, unknown> = {};
      if (network) {
        where.network = network;
      }

      const resources = await db.resource.findMany({
        where,
        take: 1000
      });

      let indexedCount = 0;
      for (const resource of resources) {
        try {
          // Build search document
          const body = buildSearchBody(resource);
          const ranking = buildRankingFields(resource);

          // Update SearchDocument in database
          await db.searchDocument.upsert({
            where: { resourceId: resource.id },
            create: {
              resourceId: resource.id,
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

          indexedCount++;
        } catch (err) {
          const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
          job.log(`Failed to index resource ${resource.id}: ${errorMsg}`);
        }
      }

      job.log(`Search index rebuild complete: ${indexedCount} resources indexed`);

      // Record the sync event
      await db.catalogEvent.create({
        data: {
          type: "search_sync",
          status: "success",
          reason: null,
          metadata: {
            action: "rebuild",
            indexedCount,
            network: network ?? "all"
          }
        }
      });
    } else if (action === "mark_stale") {
      job.log("Marking search documents as stale");

      // Mark specific resource as stale
      if (resourceId) {
        await db.searchDocument.update({
          where: { resourceId },
          data: { stale: true }
        });

        job.log(`Marked resource ${resourceId} search document as stale`);
      } else {
        // Mark all documents as stale
        await db.searchDocument.updateMany({
          data: { stale: true }
        });

        job.log("Marked all search documents as stale");
      }

      // Record the stale marking event
      const eventData: {
        resourceId?: string;
        type: string;
        status: string;
        reason: null;
        metadata: Record<string, unknown>;
      } = {
        type: "search_sync",
        status: "success",
        reason: null,
        metadata: {
          action: "mark_stale",
          resourceId: resourceId ?? "all"
        }
      };

      if (resourceId) {
        eventData.resourceId = resourceId;
      }

      await db.catalogEvent.create({
        data: eventData as Parameters<typeof db.catalogEvent.create>[0]["data"]
      });
    }
  } catch (err) {
    const errorMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
    job.log(`Search sync job failed: ${errorMsg}`);

    // Record failure
    try {
      const db = getPrismaClient();
      const failureData: {
        resourceId?: string;
        type: string;
        status: string;
        reason: string;
        metadata: Record<string, unknown>;
      } = {
        type: "search_sync",
        status: "failed",
        reason: errorMsg,
        metadata: {
          action,
          error: errorMsg
        }
      };

      if (resourceId) {
        failureData.resourceId = resourceId;
      }

      await db.catalogEvent.create({
        data: failureData as Parameters<typeof db.catalogEvent.create>[0]["data"]
      });
    } catch {
      job.log("Failed to record search sync failure event");
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
