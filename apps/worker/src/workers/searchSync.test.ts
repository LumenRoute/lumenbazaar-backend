import { type Job } from "bullmq";
import { type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { handleSearchSync, type SearchSyncJobData } from "./searchSync.js";

function createJob(data: SearchSyncJobData) {
  return {
    id: "search-sync-1",
    data,
    log: vi.fn().mockResolvedValue(1)
  } as unknown as Job<SearchSyncJobData>;
}

function resourceRow(moderationState: string) {
  return {
    id: "resource_1",
    sellerId: "seller_1",
    name: "Paid Weather API",
    description: "Returns weather data.",
    type: "http",
    network: "stellar:testnet",
    assetCode: "USDC",
    routeTemplate: "/weather/{city}",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    extensions: {},
    moderationState
  };
}

describe("search sync worker moderation exclusion", () => {
  it("marks quarantined resources as excluded during a rebuild", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "doc_1" });
    const createCatalogEvent = vi.fn().mockResolvedValue({ id: "event_1" });
    const db = {
      resource: {
        findMany: vi.fn().mockResolvedValue([resourceRow("quarantined")]),
        findUnique: vi.fn().mockResolvedValue({ moderationState: "quarantined" })
      },
      searchDocument: { upsert },
      catalogEvent: { create: createCatalogEvent }
    } as unknown as PrismaClient;

    const job = createJob({ action: "rebuild" });
    await handleSearchSync(job, { db });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          moderationState: "quarantined",
          stale: true
        }),
        update: expect.objectContaining({
          moderationState: "quarantined",
          stale: true
        })
      })
    );
    expect(createCatalogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ indexedCount: 0, excludedCount: 1 })
        })
      })
    );
  });

  it("does not let a stale rebuild snapshot overwrite a concurrent quarantine", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "doc_1" });
    const db = {
      resource: {
        // The rebuild query saw a visible resource before quarantine committed.
        findMany: vi.fn().mockResolvedValue([resourceRow("visible")]),
        // The pre-write re-read observes the committed quarantine.
        findUnique: vi.fn().mockResolvedValue({ moderationState: "quarantined" })
      },
      searchDocument: { upsert },
      catalogEvent: { create: vi.fn().mockResolvedValue({ id: "event_1" }) }
    } as unknown as PrismaClient;

    const job = createJob({ action: "rebuild" });
    await handleSearchSync(job, { db });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          moderationState: "quarantined",
          stale: true
        })
      })
    );
  });
});
