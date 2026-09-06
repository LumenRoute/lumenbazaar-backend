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

    const output = await metrics.collect();

    expect(output).toContain("lumenbazaar_api_uptime_seconds");
    expect(output).toContain("lumenbazaar_verify_latency_seconds");
    expect(output).toContain("lumenbazaar_settle_latency_seconds");
    expect(output).toContain("lumenbazaar_rpc_errors_total");
    expect(output).toContain("lumenbazaar_settlement_success_rate");
    expect(output).toContain("lumenbazaar_queue_depth");
    expect(output).toContain("lumenbazaar_search_latency_seconds");
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
      setQueueDepth: vi.fn()
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
