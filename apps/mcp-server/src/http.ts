import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { getReleaseCommit, loadConfig, serviceName } from "@lumenbazaar/shared";

import { BackendClient } from "./client.js";
import { createMcpServer, mcpToolSchemaDocument } from "./server.js";
import { createMcpMetricsService, mcpMetricRoute, type McpMetricsService } from "./metrics.js";
import { type McpToolCapabilities } from "./tools.js";

export type McpHttpServerOptions = {
  host?: string;
  path?: string;
  port?: number;
  client?: BackendClient;
  capabilityProvider?: () => Promise<McpToolCapabilities>;
  requestGuard?: McpHttpRequestGuard;
  metrics?: McpMetricsService;
};

export type McpHttpServerHandle = {
  close: () => Promise<void>;
  host: string;
  path: string;
  port: number;
  url: string;
};

type McpHttpTransport = Pick<StreamableHTTPServerTransport, "close" | "handleRequest">;

type McpHttpRouteOptions = {
  capabilityProvider?: () => Promise<McpToolCapabilities>;
  environment?: string;
  requestGuard?: McpHttpRequestGuard;
  metrics?: McpMetricsService;
};

export class McpHttpRequestGuard {
  private readonly requests = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = 120,
    private readonly windowMs = 60_000,
    private readonly maxBodyBytes = 1024 * 1024,
    private readonly trustProxy = false
  ) {}

  check(request: IncomingMessage) {
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > this.maxBodyBytes) {
      return { allowed: false as const, status: 413, error: "request_too_large" };
    }

    const now = Date.now();
    const key = this.clientKey(request);
    const current = this.requests.get(key);
    const state =
      current === undefined || current.resetAt <= now
        ? { count: 0, resetAt: now + this.windowMs }
        : current;
    state.count += 1;
    this.requests.set(key, state);
    if (state.count > this.limit) {
      return {
        allowed: false as const,
        status: 429,
        error: "rate_limited",
        retryAfter: Math.max(1, Math.ceil((state.resetAt - now) / 1000))
      };
    }
    return { allowed: true as const };
  }

  private clientKey(request: IncomingMessage) {
    if (this.trustProxy) {
      const forwarded = request.headers["x-forwarded-for"];
      const clientIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
        ?.split(",")
        .at(-1)
        ?.trim();
      if (clientIp !== undefined && isIP(clientIp) !== 0) {
        return clientIp;
      }
    }
    return request.socket.remoteAddress ?? "unknown";
  }
}

export async function startMcpHttpServer(
  options: McpHttpServerOptions = {}
): Promise<McpHttpServerHandle> {
  const config = loadConfig();
  const host = options.host ?? process.env.MCP_HOST ?? config.api.host;
  const path = normalizePath(options.path ?? process.env.MCP_PATH ?? "/mcp");
  const port = options.port ?? Number(process.env.MCP_PORT ?? 3001);
  const client = options.client ?? new BackendClient();
  const capabilityProvider = options.capabilityProvider ?? (() => client.getToolCapabilities());
  const requestGuard =
    options.requestGuard ??
    new McpHttpRequestGuard(120, 60_000, 1024 * 1024, process.env.MCP_TRUST_PROXY === "true");
  const metrics = options.metrics ?? createMcpMetricsService();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID()
  });
  const mcpServer = createMcpServer({ client, capabilityProvider, metrics });

  await mcpServer.connect(transport as unknown as Transport);

  const httpServer = createServer((request, response) => {
    handleMcpHttpRequest(request, response, transport, path, {
      capabilityProvider,
      requestGuard,
      metrics,
      environment: config.lumenEnv
    }).catch(() => {
      sendJson(response, 500, {
        ok: false,
        error: "internal_error"
      });
    });
  });

  await new Promise<void>((resolvePromise, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolvePromise();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const publicHost = host === "0.0.0.0" ? "localhost" : host;
  const url = `http://${publicHost}:${actualPort}${path}`;

  return {
    async close() {
      await transport.close();
      await new Promise<void>((resolvePromise, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolvePromise();
        });
      });
    },
    host,
    path,
    port: actualPort,
    url
  };
}

export async function handleMcpHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  transport: McpHttpTransport,
  mcpPath = "/mcp",
  options: McpHttpRouteOptions = {}
) {
  const requestPath = parseMcpRequestPath(request.url);
  const expectedPath = normalizePath(mcpPath);
  const metricRoute = mcpMetricRoute(requestPath, expectedPath);

  response.once("finish", () => {
    const result =
      response.statusCode === 429
        ? "rate_limited"
        : response.statusCode >= 400
          ? "rejected"
          : "accepted";
    options.metrics?.recordHttp(metricRoute, result);
  });

  if (requestPath === null) {
    sendJson(response, 400, {
      ok: false,
      error: "invalid_request_url"
    });
    return;
  }

  const guardResult = options.requestGuard?.check(request);
  if (guardResult?.allowed === false) {
    if (guardResult.retryAfter !== undefined) {
      response.setHeader("retry-after", String(guardResult.retryAfter));
    }
    sendJson(response, guardResult.status, { ok: false, error: guardResult.error });
    return;
  }

  if (requestPath === "/health") {
    if (request.method !== "GET") return methodNotAllowed(response);
    sendJson(response, 200, {
      ok: true,
      service: serviceName,
      app: "mcp-server",
      transport: "streamable-http"
    });
    return;
  }

  if (requestPath === "/ready") {
    if (request.method !== "GET") return methodNotAllowed(response);
    const capabilities = await probeCapabilities(options.capabilityProvider);
    sendJson(response, capabilities.backend ? 200 : 503, {
      ok: capabilities.backend,
      service: serviceName,
      app: "mcp-server",
      capabilities
    });
    return;
  }

  if (requestPath === "/version") {
    if (request.method !== "GET") return methodNotAllowed(response);
    sendJson(response, 200, {
      service: serviceName,
      app: "mcp-server",
      version: "0.1.0",
      commit: getReleaseCommit(),
      environment: options.environment ?? "unknown"
    });
    return;
  }

  if (requestPath === "/schema") {
    if (request.method !== "GET") return methodNotAllowed(response);
    const capabilities = await probeCapabilities(options.capabilityProvider);
    sendJson(response, 200, mcpToolSchemaDocument(capabilities));
    return;
  }

  if (requestPath === "/metrics") {
    if (request.method !== "GET") return methodNotAllowed(response);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/plain; version=0.0.4",
      "x-content-type-options": "nosniff"
    });
    response.end((await options.metrics?.collect()) ?? "");
    return;
  }

  if (requestPath !== expectedPath) {
    sendJson(response, 404, {
      ok: false,
      error: "not_found"
    });
    return;
  }

  await transport.handleRequest(request, response);
}

async function probeCapabilities(provider: McpHttpRouteOptions["capabilityProvider"]) {
  try {
    return provider === undefined ? { backend: false, exact: false } : await provider();
  } catch {
    return { backend: false, exact: false };
  }
}

function methodNotAllowed(response: ServerResponse) {
  response.setHeader("allow", "GET");
  sendJson(response, 405, { ok: false, error: "method_not_allowed" });
}

export function parseMcpRequestPath(rawUrl: string | undefined) {
  const value = rawUrl ?? "/";

  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return null;
  }

  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return null;
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  if (response.headersSent) {
    return;
  }

  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

async function main() {
  const server = await startMcpHttpServer();
  console.log(`${serviceName} MCP HTTP server listening at ${server.url}`);
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;

if (entrypoint === import.meta.url) {
  await main();
}
