import { Counter, Registry } from "prom-client";

export type McpMetricsService = {
  collect: () => Promise<string>;
  recordHttp: (route: string, result: "accepted" | "rejected" | "rate_limited") => void;
  recordTool: (tool: string, result: "error" | "success" | "unavailable") => void;
};

const knownRoutes = ["health", "mcp", "metrics", "ready", "schema", "version"];
const knownTools = [
  "call_paid_resource",
  "get_payment_receipt",
  "inspect_budget",
  "inspect_resource",
  "list_supported_networks",
  "prepare_payment",
  "search_paid_resources"
];

export function createMcpMetricsService(): McpMetricsService {
  const registry = new Registry();
  const httpRequests = new Counter({
    name: "lumenbazaar_mcp_http_requests_total",
    help: "MCP HTTP requests by bounded route and result.",
    labelNames: ["route", "result"] as const,
    registers: [registry]
  });
  const toolCalls = new Counter({
    name: "lumenbazaar_mcp_tool_calls_total",
    help: "MCP tool calls by registered tool and result.",
    labelNames: ["tool", "result"] as const,
    registers: [registry]
  });

  return {
    collect: async () => registry.metrics(),
    recordHttp(route, result) {
      httpRequests.inc({ route: knownRoutes.includes(route) ? route : "unknown", result });
    },
    recordTool(tool, result) {
      toolCalls.inc({ tool: knownTools.includes(tool) ? tool : "unknown", result });
    }
  };
}

export function mcpMetricRoute(path: string | null, mcpPath: string) {
  if (path === mcpPath) return "mcp";
  const route = path?.slice(1) ?? "unknown";
  return knownRoutes.includes(route) ? route : "unknown";
}
