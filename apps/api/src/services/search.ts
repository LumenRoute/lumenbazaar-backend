import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  type JsonObject,
  type Resource,
  type SearchDocument,
  LumenError,
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

export type SearchDocumentStore = {
  get: (resourceId: string) => Promise<SearchDocument | undefined>;
  upsert: (document: SearchDocument) => Promise<SearchDocument>;
};

export class InMemorySearchDocumentStore implements SearchDocumentStore {
  private readonly documents = new Map<string, SearchDocument>();

  async get(resourceId: string) {
    return this.documents.get(resourceId);
  }

  async upsert(document: SearchDocument) {
    this.documents.set(document.resourceId, document);
    return document;
  }
}

export class SearchService {
  private readonly snapshots = new Map<
    string,
    { query: string; expires: number; result: SearchResult }
  >();
  private readonly snapshotTtlMs = 300_000;

  constructor(
    private readonly resourceService: ResourceService,
    private readonly metrics?: MetricsService,
    private readonly documentStore: SearchDocumentStore = new InMemorySearchDocumentStore()
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

    return this.documentStore.upsert(document);
  }

  async search(input: unknown): Promise<SearchResult> {
    const startedAt = Date.now();

    try {
      const filters = searchResourcesSchema.parse(input);
      const limit = normalizeLimit(filters.limit);
      const query = JSON.stringify([
        filters.q ?? "",
        filters.network ?? "",
        filters.asset ?? "",
        filters.type ?? "",
        filters.sellerId ?? ""
      ]);
      const now = Date.now();
      for (const [id, snapshot] of this.snapshots)
        if (snapshot.expires <= now) this.snapshots.delete(id);
      if (filters.cursor) {
        let cursor: { id: string; offset: number };
        try {
          cursor = JSON.parse(
            Buffer.from(filters.cursor, "base64url").toString("utf8")
          ) as typeof cursor;
          if (
            typeof cursor.id !== "string" ||
            !Number.isSafeInteger(cursor.offset) ||
            cursor.offset < 1 ||
            filters.cursor.length > 512
          )
            throw new Error();
        } catch {
          throw new LumenError("VALIDATION_FAILED", "Invalid search cursor.");
        }
        const snapshot = this.snapshots.get(cursor.id);
        if (!snapshot)
          throw new LumenError(
            "SEARCH_SNAPSHOT_EXPIRED",
            "Search snapshot expired; restart without a cursor.",
            { details: { restart: true } }
          );
        if (snapshot.query !== query || cursor.offset >= snapshot.result.resources.length)
          throw new LumenError("VALIDATION_FAILED", "Search cursor does not match query.");
        return this.snapshotPage(cursor.id, cursor.offset, limit, snapshot.result);
      }
      const allResources: Resource[] = [];
      let sourceCursor: string | undefined;
      do {
        const page = await this.resourceService.listResources({
          limit: 100,
          ...(sourceCursor === undefined ? {} : { cursor: sourceCursor }),
          status: "active",
          ...(filters.network === undefined ? {} : { network: filters.network }),
          ...(filters.asset === undefined ? {} : { asset: filters.asset }),
          ...(filters.type === undefined ? {} : { type: filters.type }),
          ...(filters.sellerId === undefined ? {} : { sellerId: filters.sellerId })
        });
        allResources.push(...page.resources);
        if (allResources.length > 10_000)
          throw new LumenError(
            "VALIDATION_FAILED",
            "Search snapshot capacity exceeded; narrow the query."
          );
        sourceCursor = page.nextCursor ?? undefined;
      } while (sourceCursor !== undefined);
      const queryTerms = tokenize(filters.q ?? "");
      const documentEntries = await Promise.all(
        allResources.map(
          async (resource) => [resource.id, await this.documentStore.get(resource.id)] as const
        )
      );
      const documents = new Map(documentEntries);
      const ranked = allResources
        .map((resource) => {
          const document = documents.get(resource.id);
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
        );

      const result: SearchResult = {
        resources: structuredClone(ranked),
        ranking: {
          strategy: "postgres-full-text-v1"
        },
        partialResults: allResources.some(
          (resource) => documents.get(resource.id)?.stale !== false
        ),
        nextCursor: null
      };
      if (this.snapshots.size >= 100)
        throw new LumenError(
          "RATE_LIMITED",
          "Search snapshot capacity reached; retry after expiry."
        );
      const id = randomUUID();
      this.snapshots.set(id, { query, expires: now + this.snapshotTtlMs, result });
      return this.snapshotPage(id, 0, limit, result);
    } finally {
      this.metrics?.observeSearchLatency(Date.now() - startedAt);
    }
  }
  private snapshotPage(
    id: string,
    offset: number,
    limit: number,
    result: SearchResult
  ): SearchResult {
    const end = offset + limit;
    return {
      ...result,
      resources: structuredClone(result.resources.slice(offset, end)),
      nextCursor:
        end < result.resources.length
          ? Buffer.from(JSON.stringify({ id, offset: end })).toString("base64url")
          : null
    };
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
    JSON.stringify(resource.outputSchema)
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
