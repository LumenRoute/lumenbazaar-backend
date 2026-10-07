import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const knownQueues = [
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
  observeFinality: (network: string, durationMs: number, result: "confirmed" | "failed") => void;
  recordVerification: (network: string, result: "accepted" | "rejected" | "replay") => void;
  recordReplayRejection: (network: string) => void;
  recordReconciliation: (
    network: string,
    result: "confirmed" | "dead_letter" | "needs_review" | "pending"
  ) => void;
  recordCatalog: (type: "http" | "mcp" | "unknown", result: "accepted" | "rejected") => void;
  setDependencyStatus: (
    dependency: "horizon" | "postgres" | "redis" | "rpc" | "signer",
    ready: boolean
  ) => void;
  setStuckSettlements: (network: string, count: number) => void;
  setReconciliationBacklog: (network: string, count: number) => void;
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
  const verificationTotals = new Counter({
    name: "lumenbazaar_verifications_total",
    help: "Verification outcomes by network and bounded result.",
    labelNames: ["network", "result"] as const,
    registers: [registry]
  });
  const replayRejections = new Counter({
    name: "lumenbazaar_replay_rejections_total",
    help: "Rejected replay attempts by network.",
    labelNames: ["network"] as const,
    registers: [registry]
  });
  const finality = new Histogram({
    name: "lumenbazaar_finality_seconds",
    help: "Elapsed settlement finality time by network and result.",
    labelNames: ["network", "result"] as const,
    buckets: [0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
    registers: [registry]
  });
  const reconciliationTotals = new Counter({
    name: "lumenbazaar_reconciliation_total",
    help: "Settlement reconciliation outcomes by network.",
    labelNames: ["network", "result"] as const,
    registers: [registry]
  });
  const catalogTotals = new Counter({
    name: "lumenbazaar_catalog_total",
    help: "Catalog decisions by resource type and result.",
    labelNames: ["type", "result"] as const,
    registers: [registry]
  });
  const dependencyStatus = new Gauge({
    name: "lumenbazaar_dependency_up",
    help: "Whether a bounded backend dependency passed its latest readiness probe.",
    labelNames: ["dependency"] as const,
    registers: [registry]
  });
  const stuckSettlements = new Gauge({
    name: "lumenbazaar_stuck_settlements",
    help: "Settlements awaiting reconciliation beyond the operational threshold.",
    labelNames: ["network"] as const,
    registers: [registry]
  });
  const reconciliationBacklog = new Gauge({
    name: "lumenbazaar_reconciliation_backlog",
    help: "Settlements currently requiring operator review.",
    labelNames: ["network"] as const,
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
      verifyLatency.observe({ network: safeNetwork(network) }, toSeconds(durationMs));
    },
    observeSettleLatency(network, durationMs) {
      settleLatency.observe({ network: safeNetwork(network) }, toSeconds(durationMs));
    },
    observeSearchLatency(durationMs) {
      searchLatency.observe(toSeconds(durationMs));
    },
    recordRpcError(network, operation) {
      rpcErrors.inc({ network: safeNetwork(network), operation: safeOperation(operation) });
    },
    recordSettlementResult(network, status) {
      const boundedNetwork = safeNetwork(network);
      const stats = settlementStats.get(boundedNetwork) ?? { failed: 0, settled: 0 };
      stats[status] += 1;
      settlementStats.set(boundedNetwork, stats);
      settlementTotals.inc({ network: boundedNetwork, status });
      settlementSuccessRate.set(
        { network: boundedNetwork },
        stats.settled / (stats.settled + stats.failed)
      );
    },
    setQueueDepth(queue, depth) {
      if (knownQueues.includes(queue)) {
        queueDepth.set({ queue }, Math.max(0, depth));
      }
    },
    observeFinality(network, durationMs, result) {
      finality.observe({ network: safeNetwork(network), result }, toSeconds(durationMs));
    },
    recordVerification(network, result) {
      verificationTotals.inc({ network: safeNetwork(network), result });
    },
    recordReplayRejection(network) {
      replayRejections.inc({ network: safeNetwork(network) });
    },
    recordReconciliation(network, result) {
      reconciliationTotals.inc({ network: safeNetwork(network), result });
    },
    recordCatalog(type, result) {
      catalogTotals.inc({ type, result });
    },
    setDependencyStatus(dependency, ready) {
      dependencyStatus.set({ dependency }, ready ? 1 : 0);
    },
    setStuckSettlements(network, count) {
      stuckSettlements.set({ network: safeNetwork(network) }, Math.max(0, count));
    },
    setReconciliationBacklog(network, count) {
      reconciliationBacklog.set({ network: safeNetwork(network) }, Math.max(0, count));
    }
  };
}

function toSeconds(durationMs: number) {
  return durationMs / 1000;
}

function safeNetwork(network: string) {
  return network === "stellar:testnet" || network === "stellar:pubnet" ? network : "unknown";
}

function safeOperation(operation: string) {
  return operation === "verify" || operation === "settle" || operation === "reconcile"
    ? operation
    : "unknown";
}
