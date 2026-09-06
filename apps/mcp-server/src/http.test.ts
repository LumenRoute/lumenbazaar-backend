import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import { handleMcpHttpRequest, startMcpHttpServer } from "./http.js";

describe("MCP HTTP server", () => {
  it("exposes a deployment health endpoint", async () => {
    const server = await startMcpHttpServer({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        app: "mcp-server",
        transport: "streamable-http"
      });
    } finally {
      await server.close();
    }
  });

  it("routes only the configured MCP path to the transport", async () => {
    let handled = 0;
    const transport = {
      async close() {},
      async handleRequest(_request: IncomingMessage, response: ServerResponse) {
        handled += 1;
        response.writeHead(202, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      }
    };
    const server = createServer((request, response) => {
      handleMcpHttpRequest(request, response, transport, "/agent").catch((error) => {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: String(error) }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    try {
      const missing = await fetch(`http://127.0.0.1:${port}/mcp`);
      const routed = await fetch(`http://127.0.0.1:${port}/agent`);

      expect(missing.status).toBe(404);
      expect(routed.status).toBe(202);
      expect(handled).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });
});
