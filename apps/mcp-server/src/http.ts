import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { loadConfig, serviceName } from "@lumenbazaar/shared";

import { createMcpServer } from "./server.js";

export type McpHttpServerOptions = {
  host?: string;
  path?: string;
  port?: number;
  stateful?: boolean;
};

export type McpHttpServerHandle = {
  close: () => Promise<void>;
  host: string;
  path: string;
  port: number;
  url: string;
};

type McpHttpTransport = Pick<StreamableHTTPServerTransport, "close" | "handleRequest">;

export async function startMcpHttpServer(
  options: McpHttpServerOptions = {}
): Promise<McpHttpServerHandle> {
  const config = loadConfig();
  const host = options.host ?? process.env.MCP_HOST ?? config.api.host;
  const path = normalizePath(options.path ?? process.env.MCP_PATH ?? "/mcp");
  const port = options.port ?? Number(process.env.MCP_PORT ?? 3001);
  const transport = new StreamableHTTPServerTransport(
    options.stateful === true
      ? {
          sessionIdGenerator: () => randomUUID()
        }
      : {}
  );
  const mcpServer = createMcpServer();

  await mcpServer.connect(transport as unknown as Transport);

  const httpServer = createServer((request, response) => {
    handleMcpHttpRequest(request, response, transport, path).catch((error) => {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
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
  mcpPath = "/mcp"
) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const expectedPath = normalizePath(mcpPath);

  if (requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: serviceName,
      app: "mcp-server",
      transport: "streamable-http"
    });
    return;
  }

  if (requestUrl.pathname !== expectedPath) {
    sendJson(response, 404, {
      ok: false,
      error: "not_found"
    });
    return;
  }

  await transport.handleRequest(request, response);
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  if (response.headersSent) {
    return;
  }

  response.writeHead(statusCode, {
    "content-type": "application/json"
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
