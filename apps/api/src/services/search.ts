import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  type JsonObject,
  type Resource,
  type SearchDocument,
  normalizeLimit
} from "@lumenbazaar/shared";

import { type ResourceService } from "./resources.js";
import { type MetricsService } from "./metrics.js";

export const searchResourcesSchema = z.object({
  q: z.string().trim().optional(),
  network: z.enum(["stellar:testnet", "stellar:pubnet"]).optional(),
  asset: z.string().optional(),
  type: z.enum(["http", "mcp"]).optional(),
  sellerId: z.string().optional(),
  limit: z.coerce.number().optional(),
  cursor: z.string().optional()
});

export type SearchResourcesInput = z.output<typeof searchResourcesSchema>;

export type SearchResult = {
  resources: Array<
    Resource & {
      ranking: {
        score: number;
        matchedTerms: string[];
      };
    }
  >;
  ranking: {
    strategy: "postgres-full-text-v1";
  };
  partialResults: boolean;
  nextCursor: string | null;
};

export class SearchService {
  private readonly documents = new Map<string, SearchDocument>();

  constructor(
    private readonly resourceService: ResourceService,
    private readonly metrics?: MetricsService
  ) {}

  async rebuildIndex() {
    const page = await this.resourceService.listResources({ limit: 100 });

    for (const resource of page.resources) {
      await this.indexResource(resource);
    }

    return {
      indexed: page.resources.length
    };
  }

  async indexResource(resource: Resource) {
    const now = new Date().toISOString();
    const body = buildSearchBody(resource);
    const document: SearchDocument = {
      id: `search_doc_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      resourceId: resource.id,
      sellerId: resource.sellerId,
      body,
      ranking: rankingFields(resource),
      indexedAt: now,
      stale: false,
      createdAt: now,
      updatedAt: now
    };

    this.documents.set(resource.id, document);
    return document;
  }

  async search(input: unknown): Promise<SearchResult> {
    const startedAt = Date.now();

    try {
      const filters = searchResourcesSchema.parse(input);
      const limit = normalizeLimit(filters.limit);
      const page = await this.resourceService.listResources({
        limit: 100,
        ...(filters.network === undefined ? {} : { network: filters.network }),
        ...(filters.asset === undefined ? {} : { asset: filters.asset }),
        ...(filters.type === undefined ? {} : { type: filters.type }),
        ...(filters.sellerId === undefined ? {} : { sellerId: filters.sellerId })
      });
      const queryTerms = tokenize(filters.q ?? "");
      const ranked = page.resources
        .map((resource) => {
          const document = this.documents.get(resource.id);
          const body = document?.body ?? buildSearchBody(resource);
          const matchedTerms = queryTerms.filter((term) => body.includes(term));
          const score = scoreResource(resource, matchedTerms, document);

          return {
            ...resource,
            ranking: {
              score,
              matchedTerms
            }
          };
        })
        .filter((resource) => queryTerms.length === 0 || resource.ranking.matchedTerms.length > 0)
        .sort(
          (left, right) =>
            right.ranking.score - left.ranking.score ||
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id)
        )
        .slice(0, limit);

      return {
        resources: ranked,
        ranking: {
          strategy: "postgres-full-text-v1"
        },
        partialResults: page.resources.some(
          (resource) => this.documents.get(resource.id)?.stale !== false
        ),
        nextCursor: null
      };
    } finally {
      this.metrics?.observeSearchLatency(Date.now() - startedAt);
    }
  }
}

function buildSearchBody(resource: Resource) {
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

function rankingFields(resource: Resource): JsonObject {
  return {
    metadataQuality: schemaQuality(resource.inputSchema, resource.outputSchema),
    resourceType: resource.type,
    network: resource.network,
    asset: resource.assetCode,
    sellerVerified: resource.extensions.trusted === true,
    historicalUptime: 1,
    recentSettlementSuccess: 1
  };
}

function scoreResource(
  resource: Resource,
  matchedTerms: string[],
  document: SearchDocument | undefined
) {
  const ranking = document?.ranking ?? rankingFields(resource);
  const quality =
    typeof ranking.metadataQuality === "number"
      ? ranking.metadataQuality
      : schemaQuality(resource.inputSchema, resource.outputSchema);
  const exactNameBoost = matchedTerms.some((term) => resource.name.toLowerCase().includes(term))
    ? 5
    : 0;

  return matchedTerms.length * 10 + quality + exactNameBoost;
}

function schemaQuality(inputSchema: JsonObject, outputSchema: JsonObject) {
  const inputProperties = countProperties(inputSchema);
  const outputProperties = countProperties(outputSchema);

  return (
    inputProperties +
    outputProperties +
    (inputSchema.type === "object" ? 1 : 0) +
    (outputSchema.type === "object" ? 1 : 0)
  );
}

function countProperties(schema: JsonObject) {
  const properties = schema.properties;

  return typeof properties === "object" && properties !== null && !Array.isArray(properties)
    ? Object.keys(properties).length
    : 0;
}

function tokenize(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0);
}
