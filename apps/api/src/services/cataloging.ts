import { randomUUID } from "node:crypto";

import { LumenError, type CatalogEvent, type JsonObject } from "@lumenbazaar/shared";

import { type CatalogValidationService } from "./catalogValidation.js";
import { parseDiscoveryMetadata, toResourceCreateInput } from "./discoveryMetadata.js";
import { type ResourceService } from "./resources.js";
import { type AuditLogService } from "./audit.js";
import { type MetricsService } from "./metrics.js";

export type ResourceIndexingJob = {
  name: "resource.index";
  resourceId: string;
  versionId: string;
};

export type ResourceIndexingQueue = {
  addResourceIndexingJob: (job: ResourceIndexingJob) => Promise<void>;
};

export class InMemoryResourceIndexingQueue implements ResourceIndexingQueue {
  readonly jobs: ResourceIndexingJob[] = [];

  async addResourceIndexingJob(job: ResourceIndexingJob) {
    this.jobs.push(job);
  }
}

export type CatalogEventStore = {
  createCatalogEvent: (input: Omit<CatalogEvent, "id" | "createdAt">) => Promise<CatalogEvent>;
};

export class InMemoryCatalogEventStore implements CatalogEventStore {
  private readonly events = new Map<string, CatalogEvent>();

  async createCatalogEvent(input: Omit<CatalogEvent, "id" | "createdAt">) {
    const event: CatalogEvent = {
      id: `catalog_event_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      ...input,
      createdAt: new Date().toISOString()
    };

    this.events.set(event.id, event);
    return event;
  }
}

export type CatalogServiceOptions = {
  auditLogService?: AuditLogService;
  eventStore?: CatalogEventStore;
  indexingQueue?: ResourceIndexingQueue;
  metrics?: MetricsService;
};

export class CatalogService {
  private readonly auditLogService: AuditLogService | undefined;
  private readonly eventStore: CatalogEventStore;
  private readonly indexingQueue: ResourceIndexingQueue;
  private readonly metrics: MetricsService | undefined;

  constructor(
    private readonly validationService: CatalogValidationService,
    private readonly resourceService: ResourceService,
    options: CatalogServiceOptions = {}
  ) {
    this.auditLogService = options.auditLogService;
    this.eventStore = options.eventStore ?? new InMemoryCatalogEventStore();
    this.indexingQueue = options.indexingQueue ?? new InMemoryResourceIndexingQueue();
    this.metrics = options.metrics;
  }

  async catalog(input: unknown) {
    const validation = await this.validationService.validate(input);

    if (!validation.ok) {
      this.metrics?.recordCatalog(discoveryType(input), "rejected");
      throw new LumenError("CATALOG_VALIDATION_FAILED", "Catalog validation failed.", {
        details: {
          errors: validation.errors
        }
      });
    }

    const metadata = parseDiscoveryMetadata(input);
    const resource = await this.resourceService.createResource(toResourceCreateInput(metadata));
    const version = await this.resourceService.getStore().getLatestVersion(resource.id);

    if (version === undefined) {
      throw new LumenError("INTERNAL_ERROR", "Resource version was not created.");
    }

    const event = await this.eventStore.createCatalogEvent({
      resourceId: resource.id,
      sellerId: resource.sellerId,
      type: "cataloged",
      status: "accepted",
      reason: null,
      metadata: {
        metadataVersion: metadata.metadataVersion,
        resource: metadata.resource as JsonObject
      }
    });

    await this.indexingQueue.addResourceIndexingJob({
      name: "resource.index",
      resourceId: resource.id,
      versionId: version.id
    });

    await this.auditLogService?.record({
      action: "resource.catalog",
      actorId: resource.sellerId,
      actorType: "seller",
      targetId: resource.id,
      targetType: "resource",
      metadata: {
        assetCode: resource.assetCode,
        catalogEventId: event.id,
        network: resource.network,
        routeTemplate: resource.routeTemplate,
        status: resource.status,
        type: resource.type,
        versionId: version.id
      }
    });
    this.metrics?.recordCatalog(resource.type, "accepted");

    return {
      ok: true,
      resourceId: resource.id,
      versionId: version.id,
      catalogEventId: event.id,
      indexingStatus: "queued" as const
    };
  }
}

function discoveryType(input: unknown): "http" | "mcp" | "unknown" {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "unknown";
  const resource = (input as Record<string, unknown>).resource;
  if (typeof resource !== "object" || resource === null || Array.isArray(resource))
    return "unknown";
  const type = (resource as Record<string, unknown>).type;
  return type === "http" || type === "mcp" ? type : "unknown";
}
