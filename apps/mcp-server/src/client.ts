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
    return unwrapApiData<Record<string, unknown>>(await response.json());
  }

  /**
   * List all supported networks
   */
  async listNetworks(): Promise<Array<{ id: string; name: string; chain: string }>> {
    const response = await fetch(`${this.baseUrl}/v1/networks`);
    if (!response.ok) {
      throw new Error(`Failed to fetch /v1/networks: ${response.statusText}`);
    }
    const data = unwrapApiData<Record<string, unknown>>(await response.json());
    const networks = asRecordArray(data.networks);

    return networks.map((n) => ({
      id: (n.id as string) || "",
      name: (n.displayName as string) || (n.name as string) || "",
      chain: (n.chain as string) || "stellar"
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
    const data = unwrapApiData<Record<string, unknown>>(await response.json());
    const resources = asRecordArray(data.resources).map(withPaymentTerms);
    const cursor = (data.cursor ?? data.nextCursor) as string | undefined;
    const total = data.total as number | undefined;

    const result: { resources: Array<Record<string, unknown>>; cursor?: string; total?: number } = {
      resources
    };
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
    const response = await fetch(`${this.baseUrl}/v1/resources/${resourceId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch resource ${resourceId}: ${response.statusText}`);
    }
    return withPaymentTerms(unwrapApiData<Record<string, unknown>>(await response.json()));
  }

  /**
   * Get payment receipt by ID
   */
  async getReceipt(receiptId: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/v1/receipts/${receiptId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch receipt ${receiptId}: ${response.statusText}`);
    }
    return unwrapApiData<Record<string, unknown>>(await response.json());
  }
}

export function createBackendClient(baseUrl?: string): BackendClient {
  return new BackendClient(baseUrl);
}

function unwrapApiData<T>(input: unknown): T {
  if (typeof input === "object" && input !== null && "ok" in input && "data" in input) {
    return (input as { data: T }).data;
  }

  return input as T;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function withPaymentTerms(resource: Record<string, unknown>) {
  if (resource.paymentTerms !== undefined) {
    return resource;
  }

  return {
    ...resource,
    paymentTerms: {
      scheme: "exact",
      network: resource.network,
      asset: {
        code: resource.assetCode,
        issuer: resource.assetIssuer
      },
      amount: resource.amount,
      payTo: resource.payTo
    }
  };
}
