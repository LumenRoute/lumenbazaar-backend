import { type Job } from "bullmq";

import { getPrismaClient } from "@lumenbazaar/shared";

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
              ranking,
              indexedAt: new Date(),
              stale: false
            },
            update: {
              body,
              ranking,
              indexedAt: new Date(),
              stale: false
            }
          });

          indexedCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
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
      await db.catalogEvent.create({
        data: {
          resourceId,
          type: "search_sync",
          status: "success",
          reason: null,
          metadata: {
            action: "mark_stale",
            resourceId: resourceId ?? "all"
          }
        }
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    job.log(`Search sync job failed: ${errorMsg}`);

    // Record failure
    try {
      const db = getPrismaClient();
      await db.catalogEvent.create({
        data: {
          type: "search_sync",
          status: "failed",
          reason: errorMsg,
          metadata: {
            action,
            resourceId: resourceId ?? null,
            error: errorMsg
          }
        }
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
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  extensions: Record<string, unknown>;
}): string {
  return [
    resource.name,
    resource.description,
    resource.type,
    resource.network,
    resource.assetCode,
    resource.routeTemplate,
    JSON.stringify(resource.inputSchema),
    JSON.stringify(resource.outputSchema),
    JSON.stringify(resource.extensions)
  ]
    .join(" ")
    .toLowerCase();
}

function buildRankingFields(resource: {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  type: string;
  network: string;
  assetCode: string;
  extensions: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    metadataQuality: schemaQuality(
      resource.inputSchema as Record<string, unknown>,
      resource.outputSchema as Record<string, unknown>
    ),
    resourceType: resource.type,
    network: resource.network,
    asset: resource.assetCode,
    sellerVerified: resource.extensions.trusted === true,
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
