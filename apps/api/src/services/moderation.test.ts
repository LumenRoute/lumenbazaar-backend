import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { AuditLogService, InMemoryAuditLogStore } from "./audit.js";
import { DiscoveryService } from "./discovery.js";
import { InMemoryModerationStore, ModerationService, type ModerationStore } from "./moderation.js";
import { ResourceService } from "./resources.js";
import { InMemorySearchDocumentStore, SearchService } from "./search.js";
import { SellerService } from "./sellers.js";

function resourceInput(sellerId: string) {
  return {
    sellerId,
    type: "http" as const,
    name: "Paid Weather API",
    description: "Returns current weather for a city.",
    url: "https://seller.example/weather/Lagos",
    routeTemplate: "/weather/{city}",
    network: "stellar:testnet" as const,
    payTo: localIssuerPublicKey,
    assetCode: "USDC",
    assetIssuer: localIssuerPublicKey,
    amount: "0.05",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } }
    },
    outputSchema: {
      type: "object",
      properties: { temperature: { type: "number" } }
    },
    extensions: { bazaar: true }
  };
}

async function setup() {
  const config = loadConfig({ STELLAR_TESTNET_USDC_ISSUER: localIssuerPublicKey });
  const sellerService = new SellerService();
  const resourceService = new ResourceService(config, sellerService);
  const auditLogStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditLogStore);
  const moderationStore: ModerationStore = new InMemoryModerationStore(resourceService.getStore());
  const moderationService = new ModerationService(
    resourceService,
    moderationStore,
    auditLogService
  );
  const searchDocumentStore = new InMemorySearchDocumentStore();
  const searchService = new SearchService(resourceService, undefined, searchDocumentStore);
  const discoveryService = new DiscoveryService(resourceService);
  const seller = await sellerService.createSeller({
    displayName: "Weather Seller",
    walletAddress: localIssuerPublicKey,
    domain: "seller.example"
  });
  const resource = await resourceService.createResource(resourceInput(seller.id));
  await searchService.indexResource(resource);

  return {
    seller,
    resource,
    resourceService,
    moderationService,
    moderationStore,
    searchService,
    searchDocumentStore,
    discoveryService,
    auditLogStore
  };
}

const evidence = [
  {
    type: "report" as const,
    ref: "synthetic://moderation/report/001",
    description: "Synthetic testnet abuse report"
  }
];

function quarantineInput(overrides: Record<string, unknown> = {}) {
  return {
    reasonCode: "deceptive",
    evidenceRefs: evidence,
    reviewerId: "operator_alice",
    ...overrides
  };
}

describe("catalog moderation", () => {
  it("hides quarantined versions from discovery and search and exposes attributable state", async () => {
    const { seller, resource, moderationService, discoveryService, searchService, auditLogStore } =
      await setup();

    await expect(discoveryService.browse({})).resolves.toMatchObject({
      resources: [{ id: resource.id }]
    });
    await expect(searchService.search({ q: "weather" })).resolves.toMatchObject({
      resources: [{ id: resource.id }]
    });

    const view = await moderationService.quarantineVersion(resource.id, 1, quarantineInput());

    expect(view).toMatchObject({
      resourceId: resource.id,
      resourceStatus: "active",
      moderationState: "quarantined",
      discoveryState: "quarantined",
      appealable: true,
      notificationStatus: "pending"
    });
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]).toMatchObject({
      action: "quarantine",
      reasonCode: "deceptive",
      reviewerId: "operator_alice",
      reviewerType: "operator",
      evidenceRefs: evidence
    });

    await expect(discoveryService.browse({})).resolves.toMatchObject({ resources: [] });
    await expect(searchService.search({ q: "weather" })).resolves.toMatchObject({
      resources: []
    });

    const sellerView = await moderationService.getSellerView(seller.id, resource.id);
    expect(sellerView).toMatchObject({
      discoveryState: "quarantined",
      moderationState: "quarantined"
    });

    const logs = await auditLogStore.list();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "resource.quarantined",
          actorId: "operator_alice",
          targetId: view.actions[0]!.versionId
        })
      ])
    );

    const notification = view.notifications[0]!;
    const updated = await moderationService.markNotificationStatus(notification.id, {
      status: "notified",
      reviewerId: "operator_alice"
    });
    expect(updated).toMatchObject({ status: "notified" });
    expect(updated.notifiedAt).not.toBeNull();
  });

  it("supports appeal, appeal rejection, and restore without rewriting seller metadata", async () => {
    const { seller, resource, resourceService, moderationService, discoveryService } =
      await setup();

    await moderationService.quarantineVersion(resource.id, 1, quarantineInput());
    const appealed = await moderationService.submitAppeal(
      resource.id,
      1,
      {
        message: "This is a false positive on synthetic testnet data.",
        evidenceRefs: [{ type: "url", ref: "https://seller.example/moderation/appeal-001" }]
      },
      { sellerId: seller.id, auditable: true }
    );

    expect(appealed).toMatchObject({
      moderationState: "under_appeal",
      discoveryState: "quarantined",
      appealable: false
    });
    expect(appealed.actions.at(-1)).toMatchObject({
      action: "appeal",
      reviewerId: seller.id,
      reviewerType: "seller"
    });
    expect(appealed.quarantine).toMatchObject({ version: 1, reasonCode: "deceptive" });
    await expect(discoveryService.browse({})).resolves.toMatchObject({ resources: [] });

    const rejected = await moderationService.rejectAppeal(resource.id, 1, {
      reasonCode: "deceptive",
      reviewerId: "operator_bob",
      notes: "Evidence still stands."
    });
    expect(rejected).toMatchObject({ moderationState: "quarantined", appealable: true });

    const restored = await moderationService.restoreVersion(resource.id, 1, {
      reasonCode: "appeal_upheld",
      reviewerId: "operator_bob",
      notifySeller: true
    });
    expect(restored).toMatchObject({
      moderationState: "visible",
      discoveryState: "discoverable"
    });
    await expect(discoveryService.browse({})).resolves.toMatchObject({
      resources: [{ id: resource.id }]
    });

    const version = await resourceService.getResourceVersion(resource.id, 1);
    expect(version.metadata).toMatchObject({ name: "Paid Weather API" });
    expect(restored.actions.map((action) => action.action)).toEqual([
      "quarantine",
      "appeal",
      "reject_appeal",
      "restore"
    ]);
    expect(restored.actions[0]).toMatchObject({
      action: "quarantine",
      reviewerId: "operator_alice"
    });
  });

  it("treats repeat abuse as new immutable actions and hides the version again", async () => {
    const { resource, moderationService, discoveryService } = await setup();

    await moderationService.quarantineVersion(
      resource.id,
      1,
      quarantineInput({ reasonCode: "abuse" })
    );
    await moderationService.restoreVersion(resource.id, 1, {
      reasonCode: "false_positive",
      reviewerId: "operator_alice"
    });
    await expect(discoveryService.browse({})).resolves.toMatchObject({
      resources: [{ id: resource.id }]
    });

    const repeated = await moderationService.quarantineVersion(
      resource.id,
      1,
      quarantineInput({
        reasonCode: "policy_violation",
        evidenceRefs: [
          ...evidence,
          { type: "transaction", ref: "synthetic://stellar/testnet/tx/002" }
        ],
        reviewerId: "operator_bob"
      })
    );

    expect(repeated).toMatchObject({
      moderationState: "quarantined",
      discoveryState: "quarantined"
    });
    expect(repeated.actions.map((action) => action.action)).toEqual([
      "quarantine",
      "restore",
      "quarantine"
    ]);
    expect(repeated.actions[0]).toMatchObject({ reasonCode: "abuse" });
    expect(repeated.actions[2]).toMatchObject({
      reasonCode: "policy_violation",
      reviewerId: "operator_bob"
    });
    await expect(discoveryService.browse({})).resolves.toMatchObject({ resources: [] });
  });

  it("keeps versions hidden when a stale reindex races with quarantine", async () => {
    const {
      resource,
      resourceService,
      moderationService,
      searchService,
      searchDocumentStore,
      discoveryService
    } = await setup();
    const staleVisibleResource = await resourceService.getResource(resource.id);
    expect(staleVisibleResource).toBeDefined();

    await moderationService.quarantineVersion(resource.id, 1, quarantineInput());

    // Simulate an indexing job that started before quarantine and still holds a
    // stale, non-quarantined snapshot of the resource.
    await searchService.indexResource(staleVisibleResource!);

    await expect(searchService.search({ q: "weather" })).resolves.toMatchObject({
      resources: []
    });
    await expect(discoveryService.browse({})).resolves.toMatchObject({ resources: [] });

    const document = await searchDocumentStore.get(resource.id);
    expect(document).toBeDefined();

    await moderationService.restoreVersion(resource.id, 1, {
      reasonCode: "manual_restore",
      reviewerId: "operator_alice"
    });
    await searchService.indexResource((await resourceService.getResource(resource.id))!);
    await expect(searchService.search({ q: "weather" })).resolves.toMatchObject({
      resources: [{ id: resource.id }]
    });
  });
});
