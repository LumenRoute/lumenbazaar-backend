import { type JsonObject } from "@lumenbazaar/shared";

export type SearchFilters = {
  q?: string;
  network?: "stellar:testnet" | "stellar:pubnet";
  asset?: string;
  type?: "http" | "mcp";
  sellerId?: string;
  limit?: number;
  cursor?: string;
};

export type SearchResult = {
  id: string;
  name: string;
  description: string;
  type: "http" | "mcp";
  network: string;
  assetCode: string;
  amount: string;
  url: string;
  ranking: {
    score: number;
    matchedTerms: string[];
  };
};

export type SearchResponse = {
  resources: SearchResult[];
  ranking: {
    strategy: string;
  };
  partialResults: boolean;
  nextCursor: string | null;
};

/**
 * Search for paid resources in the Bazaar
 * @param apiUrl - The Bazaar API base URL
 * @param filters - Search filters
 */
export async function searchResources(
  apiUrl: string,
  filters: SearchFilters
): Promise<SearchResponse> {
  const params = new URLSearchParams();

  if (filters.q) params.append("q", filters.q);
  if (filters.network) params.append("network", filters.network);
  if (filters.asset) params.append("asset", filters.asset);
  if (filters.type) params.append("type", filters.type);
  if (filters.sellerId) params.append("sellerId", filters.sellerId);
  if (filters.limit) params.append("limit", String(filters.limit));
  if (filters.cursor) params.append("cursor", filters.cursor);

  const response = await fetch(`${apiUrl}/v1/discovery/search?${params.toString()}`, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }

  return response.json() as Promise<SearchResponse>;
}

/**
 * Search for resources by name
 */
export async function searchByName(apiUrl: string, name: string): Promise<SearchResponse> {
  return searchResources(apiUrl, { q: name, limit: 20 });
}

/**
 * Search for resources on a specific network
 */
export async function searchByNetwork(
  apiUrl: string,
  network: "stellar:testnet" | "stellar:pubnet"
): Promise<SearchResponse> {
  return searchResources(apiUrl, { network, limit: 50 });
}

/**
 * Search for resources accepting a specific asset
 */
export async function searchByAsset(
  apiUrl: string,
  assetCode: string,
  network?: "stellar:testnet" | "stellar:pubnet"
): Promise<SearchResponse> {
  const filters: SearchFilters = { asset: assetCode, limit: 50 };
  if (network !== undefined) {
    filters.network = network;
  }
  return searchResources(apiUrl, filters);
}

/**
 * Search for MCP tools
 */
export async function searchMcpTools(apiUrl: string, query?: string): Promise<SearchResponse> {
  const filters: SearchFilters = { type: "mcp", limit: 30 };
  if (query !== undefined) {
    filters.q = query;
  }
  return searchResources(apiUrl, filters);
}

/**
 * Search for HTTP endpoints
 */
export async function searchHttpEndpoints(apiUrl: string, query?: string): Promise<SearchResponse> {
  const filters: SearchFilters = { type: "http", limit: 30 };
  if (query !== undefined) {
    filters.q = query;
  }
  return searchResources(apiUrl, filters);
}
