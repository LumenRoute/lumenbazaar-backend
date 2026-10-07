import { describe, expect, it, vi } from "vitest";

import { createMetricsService, type MetricsService } from "./metrics.js";
import { type ResourceService } from "./resources.js";
import { SearchService } from "./search.js";

describe("MetricsService", () => {
  it("exposes required operator and public dashboard metrics", async () => {
    const metrics = createMetricsService();

    metrics.observeVerifyLatency("stellar:testnet", 25);
    metrics.observeSettleLatency("stellar:testnet", 50);
    metrics.observeSearchLatency(8);
    metrics.recordRpcError("stellar:testnet", "settle");
    metrics.recordSettlementResult("stellar:testnet", "settled");
    metrics.recordSettlementResult("stellar:testnet", "failed");
    metrics.setQueueDepth("settlement-confirmation", 4);
    metrics.recordVerification("stellar:testnet", "accepted");
    metrics.recordReplayRejection("stellar:testnet");
    metrics.observeFinality("stellar:testnet", 750, "confirmed");
    metrics.recordReconciliation("stellar:testnet", "needs_review");
    metrics.recordCatalog("http", "accepted");
    metrics.setDependencyStatus("postgres", true);
    metrics.setStuckSettlements("stellar:testnet", 2);
    metrics.setReconciliationBacklog("stellar:testnet", 1);

    const output = await metrics.collect();

    expect(output).toContain("lumenbazaar_api_uptime_seconds");
    expect(output).toContain("lumenbazaar_verify_latency_seconds");
    expect(output).toContain("lumenbazaar_settle_latency_seconds");
    expect(output).toContain("lumenbazaar_rpc_errors_total");
    expect(output).toContain("lumenbazaar_settlement_success_rate");
    expect(output).toContain("lumenbazaar_queue_depth");
    expect(output).toContain("lumenbazaar_search_latency_seconds");
    expect(output).toContain("lumenbazaar_verifications_total");
    expect(output).toContain("lumenbazaar_replay_rejections_total");
    expect(output).toContain("lumenbazaar_finality_seconds");
    expect(output).toContain("lumenbazaar_reconciliation_total");
    expect(output).toContain("lumenbazaar_catalog_total");
    expect(output).toContain('lumenbazaar_dependency_up{dependency="postgres"} 1');
    expect(output).toContain('lumenbazaar_stuck_settlements{network="stellar:testnet"} 2');
    expect(output).toContain('lumenbazaar_reconciliation_backlog{network="stellar:testnet"} 1');
    expect(output).toContain('lumenbazaar_settlement_success_rate{network="stellar:testnet"} 0.5');
    expect(output).toContain('lumenbazaar_queue_depth{queue="settlement-confirmation"} 4');
  });

  it("records search latency through SearchService", async () => {
    const metrics: MetricsService = {
      collect: vi.fn(async () => ""),
      observeVerifyLatency: vi.fn(),
      observeSettleLatency: vi.fn(),
      observeSearchLatency: vi.fn(),
      recordRpcError: vi.fn(),
      recordSettlementResult: vi.fn(),
      setQueueDepth: vi.fn(),
      observeFinality: vi.fn(),
      recordVerification: vi.fn(),
      recordReplayRejection: vi.fn(),
      recordReconciliation: vi.fn(),
      recordCatalog: vi.fn(),
      setDependencyStatus: vi.fn(),
      setStuckSettlements: vi.fn(),
      setReconciliationBacklog: vi.fn()
    };
    const resourceService = {
      async listResources() {
        return {
          resources: [],
          nextCursor: null
        };
      }
    } as unknown as ResourceService;
    const searchService = new SearchService(resourceService, metrics);

    await searchService.search({ q: "weather" });

    expect(metrics.observeSearchLatency).toHaveBeenCalledWith(expect.any(Number));
  });
});
