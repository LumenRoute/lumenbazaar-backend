import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  handleMcpHttpRequest,
  McpHttpRequestGuard,
  parseMcpRequestPath,
  startMcpHttpServer
} from "./http.js";

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

  it("rejects absolute, protocol-relative, and malformed request targets", () => {
    expect(parseMcpRequestPath("/mcp?session=one")).toBe("/mcp");
    expect(parseMcpRequestPath("https://attacker.example/mcp")).toBeNull();
    expect(parseMcpRequestPath("//attacker.example/mcp")).toBeNull();
    expect(parseMcpRequestPath("/\\attacker.example/mcp")).toBeNull();
    expect(parseMcpRequestPath("/mcp\u0000suffix")).toBeNull();
  });

  it("does not expose OAuth metadata or redirect unmatched paths", async () => {
    const server = await startMcpHttpServer({ host: "127.0.0.1", port: 0 });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/.well-known/oauth-authorization-server`,
        { redirect: "manual" }
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      await expect(response.json()).resolves.toEqual({ ok: false, error: "not_found" });
    } finally {
      await server.close();
    }
  });

  it("reports backend readiness, version, and capability-filtered schemas", async () => {
    const server = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      capabilityProvider: async () => ({ backend: true, exact: false })
    });

    try {
      const ready = await fetch(`http://127.0.0.1:${server.port}/ready`);
      const version = await fetch(`http://127.0.0.1:${server.port}/version`);
      const schema = await fetch(`http://127.0.0.1:${server.port}/schema`);

      expect(ready.status).toBe(200);
      await expect(ready.json()).resolves.toMatchObject({
        ok: true,
        capabilities: { backend: true, exact: false }
      });
      await expect(version.json()).resolves.toMatchObject({
        app: "mcp-server",
        version: "0.1.0"
      });
      const schemaBody = (await schema.json()) as { tools: Array<{ name: string }> };
      expect(schemaBody.tools.map((tool) => tool.name)).toContain("search_paid_resources");
      expect(schemaBody.tools.map((tool) => tool.name)).not.toContain("call_paid_resource");
    } finally {
      await server.close();
    }
  });

  it("fails readiness closed when the backend is unavailable", async () => {
    const server = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      capabilityProvider: async () => ({ backend: false, exact: false })
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/ready`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ ok: false });
    } finally {
      await server.close();
    }
  });

  it("limits abusive request rates and oversized bodies", async () => {
    const rateLimited = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      requestGuard: new McpHttpRequestGuard(1, 60_000, 1024)
    });
    try {
      expect((await fetch(`http://127.0.0.1:${rateLimited.port}/health`)).status).toBe(200);
      const second = await fetch(`http://127.0.0.1:${rateLimited.port}/health`);
      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).toBeTruthy();
    } finally {
      await rateLimited.close();
    }

    const sizeLimited = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      requestGuard: new McpHttpRequestGuard(10, 60_000, 8)
    });
    try {
      const response = await fetch(`http://127.0.0.1:${sizeLimited.port}/mcp`, {
        method: "POST",
        body: "payload too large"
      });
      expect(response.status).toBe(413);
    } finally {
      await sizeLimited.close();
    }
  });

  it("uses forwarding headers only when trusted proxy mode is explicit", async () => {
    const server = await startMcpHttpServer({
      host: "127.0.0.1",
      port: 0,
      requestGuard: new McpHttpRequestGuard(1, 60_000, 1024, true)
    });
    try {
      const first = await fetch(`http://127.0.0.1:${server.port}/health`, {
        headers: { "x-forwarded-for": "203.0.113.10" }
      });
      const secondClient = await fetch(`http://127.0.0.1:${server.port}/health`, {
        headers: { "x-forwarded-for": "203.0.113.11" }
      });
      const repeated = await fetch(`http://127.0.0.1:${server.port}/health`, {
        headers: { "x-forwarded-for": "203.0.113.10" }
      });

      expect(first.status).toBe(200);
      expect(secondClient.status).toBe(200);
      expect(repeated.status).toBe(429);
    } finally {
      await server.close();
    }
  });
});
