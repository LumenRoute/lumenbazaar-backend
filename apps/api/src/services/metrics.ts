import { Counter, Gauge, Histogram, Registry } from "prom-client";

const knownQueues = [
  "settlement-confirmation",
  "resource-indexing",
  "search-sync",
  "conformance-runner",
  "network-health",
  "receipt-finalizer",
  "stale-payment-cleanup"
];

export type MetricsService = {
  collect: () => Promise<string>;
  observeVerifyLatency: (network: string, durationMs: number) => void;
  observeSettleLatency: (network: string, durationMs: number) => void;
  observeSearchLatency: (durationMs: number) => void;
  recordRpcError: (network: string, operation: string) => void;
  recordSettlementResult: (network: string, status: "failed" | "settled") => void;
  setQueueDepth: (queue: string, depth: number) => void;
};

type SettlementStats = {
  failed: number;
  settled: number;
};

export function createMetricsService(): MetricsService {
  const registry = new Registry();
  const settlementStats = new Map<string, SettlementStats>();
  const uptime = new Gauge({
    name: "lumenbazaar_api_uptime_seconds",
    help: "API process uptime in seconds.",
    registers: [registry]
  });
  const verifyLatency = new Histogram({
    name: "lumenbazaar_verify_latency_seconds",
    help: "Payment verification latency in seconds.",
    labelNames: ["network"] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry]
  });
  const settleLatency = new Histogram({
    name: "lumenbazaar_settle_latency_seconds",
    help: "Payment settlement latency in seconds.",
    labelNames: ["network"] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry]
  });
  const searchLatency = new Histogram({
    name: "lumenbazaar_search_latency_seconds",
    help: "Discovery search latency in seconds.",
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [registry]
  });
  const rpcErrors = new Counter({
    name: "lumenbazaar_rpc_errors_total",
    help: "Stellar RPC or adapter errors by network and operation.",
    labelNames: ["network", "operation"] as const,
    registers: [registry]
  });
  const settlementTotals = new Counter({
    name: "lumenbazaar_settlements_total",
    help: "Settlement outcomes by network.",
    labelNames: ["network", "status"] as const,
    registers: [registry]
  });
  const settlementSuccessRate = new Gauge({
    name: "lumenbazaar_settlement_success_rate",
    help: "Ratio of settled payments to total settlement attempts by network.",
    labelNames: ["network"] as const,
    registers: [registry]
  });
  const queueDepth = new Gauge({
    name: "lumenbazaar_queue_depth",
    help: "Current queued job depth by queue.",
    labelNames: ["queue"] as const,
    registers: [registry]
  });

  for (const queue of knownQueues) {
    queueDepth.set({ queue }, 0);
  }

  return {
    async collect() {
      uptime.set(process.uptime());
      return registry.metrics();
    },
    observeVerifyLatency(network, durationMs) {
      verifyLatency.observe({ network }, toSeconds(durationMs));
    },
    observeSettleLatency(network, durationMs) {
      settleLatency.observe({ network }, toSeconds(durationMs));
    },
    observeSearchLatency(durationMs) {
      searchLatency.observe(toSeconds(durationMs));
    },
    recordRpcError(network, operation) {
      rpcErrors.inc({ network, operation });
    },
    recordSettlementResult(network, status) {
      const stats = settlementStats.get(network) ?? { failed: 0, settled: 0 };
      stats[status] += 1;
      settlementStats.set(network, stats);
      settlementTotals.inc({ network, status });
      settlementSuccessRate.set({ network }, stats.settled / (stats.settled + stats.failed));
    },
    setQueueDepth(queue, depth) {
      queueDepth.set({ queue }, depth);
    }
  };
}

function toSeconds(durationMs: number) {
  return durationMs / 1000;
}
