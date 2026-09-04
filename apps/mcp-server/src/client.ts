import type { z } from "zod";

/**
 * Backend client for MCP server.
 * Wraps API calls to the facilitator and discovery endpoints.
 * Configurable API base URL for local dev, testnet, or mainnet.
 */
export class BackendClient {
  private baseUrl: string;

  constructor(baseUrl: string = process.env.API_BASE_URL || "http://localhost:8000") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Fetch supported payment schemes, networks, and assets
   */
  async getSupported(): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/v1/supported`);
    if (!response.ok) {
      throw new Error(`Failed to fetch /v1/supported: ${response.statusText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    return data.data as Record<string, unknown>;
  }

  /**
   * List all supported networks
   */
  async listNetworks(): Promise<Array<{ id: string; name: string; chain: string }>> {
    const response = await fetch(`${this.baseUrl}/v1/networks`);
    if (!response.ok) {
      throw new Error(`Failed to fetch /v1/networks: ${response.statusText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const networks = (data.data as Array<Record<string, unknown>>) || [];
    return networks.map((n) => ({
      id: (n.id as string) || "",
      name: (n.name as string) || "",
      chain: (n.chain as string) || ""
    }));
  }

  /**
   * Search for paid resources with filters
   */
  async searchResources(params: {
    q?: string;
    type?: "http" | "mcp";
    network?: string;
    asset?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    resources: Array<Record<string, unknown>>;
    cursor?: string;
    total?: number;
  }> {
    const query = new URLSearchParams();
    if (params.q) query.append("q", params.q);
    if (params.type) query.append("type", params.type);
    if (params.network) query.append("network", params.network);
    if (params.asset) query.append("asset", params.asset);
    if (params.limit) query.append("limit", String(params.limit));
    if (params.cursor) query.append("cursor", params.cursor);

    const response = await fetch(`${this.baseUrl}/v1/discovery/search?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to search resources: ${response.statusText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const resources = ((data.data as Record<string, unknown>)?.resources as Array<Record<string, unknown>>) || [];
    const cursor = ((data.data as Record<string, unknown>)?.cursor as string | undefined);
    const total = ((data.data as Record<string, unknown>)?.total as number | undefined);

    const result: { resources: Array<Record<string, unknown>>; cursor?: string; total?: number } = { resources };
    if (cursor !== undefined) {
      result.cursor = cursor;
    }
    if (total !== undefined) {
      result.total = total;
    }

    return result;
  }

  /**
   * Get a specific resource by ID
   */
  async getResource(resourceId: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/v1/discovery/resources/${resourceId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch resource ${resourceId}: ${response.statusText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    return data.data as Record<string, unknown>;
  }

  /**
   * Get payment receipt by ID
   */
  async getReceipt(receiptId: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/v1/receipts/${receiptId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch receipt ${receiptId}: ${response.statusText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    return data.data as Record<string, unknown>;
  }
}

export function createBackendClient(baseUrl?: string): BackendClient {
  return new BackendClient(baseUrl);
}
