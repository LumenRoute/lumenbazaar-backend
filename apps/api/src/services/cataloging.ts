import { randomUUID } from "node:crypto";

import { LumenError, type CatalogEvent, type JsonObject } from "@lumenbazaar/shared";

import { type CatalogValidationService } from "./catalogValidation.js";
import { parseDiscoveryMetadata, toResourceCreateInput } from "./discoveryMetadata.js";
import { type ResourceService } from "./resources.js";

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
  eventStore?: CatalogEventStore;
  indexingQueue?: ResourceIndexingQueue;
};

export class CatalogService {
  private readonly eventStore: CatalogEventStore;
  private readonly indexingQueue: ResourceIndexingQueue;

  constructor(
    private readonly validationService: CatalogValidationService,
    private readonly resourceService: ResourceService,
    options: CatalogServiceOptions = {}
  ) {
    this.eventStore = options.eventStore ?? new InMemoryCatalogEventStore();
    this.indexingQueue = options.indexingQueue ?? new InMemoryResourceIndexingQueue();
  }

  async catalog(input: unknown) {
    const validation = await this.validationService.validate(input);

    if (!validation.ok) {
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

    return {
      ok: true,
      resourceId: resource.id,
      versionId: version.id,
      catalogEventId: event.id,
      indexingStatus: "queued" as const
    };
  }
}
