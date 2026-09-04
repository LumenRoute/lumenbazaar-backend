import { type JsonObject } from "@lumenbazaar/shared";

export type PaymentTerms = {
  scheme: "exact";
  network: "stellar:testnet" | "stellar:pubnet";
  asset: {
    code: string;
    issuer: string;
  };
  amount: string;
  payTo: string;
};

export type ResourceMetadata = {
  id: string;
  name: string;
  description: string;
  type: "http" | "mcp";
  url: string;
  routeTemplate?: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  paymentTerms: PaymentTerms;
};

/**
 * Inspect a resource to get its payment terms and metadata
 * @param apiUrl - The Bazaar API base URL
 * @param resourceId - The resource ID to inspect
 */
export async function inspectResource(
  apiUrl: string,
  resourceId: string
): Promise<ResourceMetadata> {
  const response = await fetch(`${apiUrl}/v1/resources/${resourceId}`, {
    method: "GET"
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Resource not found: ${resourceId}`);
    }
    throw new Error(`Failed to inspect resource: ${response.statusText}`);
  }

  const resource = (await response.json()) as Record<string, unknown>;

  const result: ResourceMetadata = {
    id: resource.id as string,
    name: resource.name as string,
    description: resource.description as string,
    type: resource.type as "http" | "mcp",
    url: resource.url as string,
    inputSchema: (resource.inputSchema as JsonObject) ?? {},
    outputSchema: (resource.outputSchema as JsonObject) ?? {},
    paymentTerms: {
      scheme: "exact",
      network: (resource.network as string) as "stellar:testnet" | "stellar:pubnet",
      asset: {
        code: resource.assetCode as string,
        issuer: resource.assetIssuer as string
      },
      amount: resource.amount as string,
      payTo: resource.payTo as string
    }
  };

  // Add optional routeTemplate only if defined
  if (resource.routeTemplate !== undefined) {
    result.routeTemplate = resource.routeTemplate as string;
  }

  return result;
}

/**
 * Get payment terms for a resource
 */
export async function getPaymentTerms(apiUrl: string, resourceId: string): Promise<PaymentTerms> {
  const resource = await inspectResource(apiUrl, resourceId);
  return resource.paymentTerms;
}

/**
 * Check resource compatibility with a specific network
 */
export async function isResourceAvailableOnNetwork(
  apiUrl: string,
  resourceId: string,
  network: "stellar:testnet" | "stellar:pubnet"
): Promise<boolean> {
  try {
    const resource = await inspectResource(apiUrl, resourceId);
    return resource.paymentTerms.network === network;
  } catch {
    return false;
  }
}

/**
 * Get resource input schema
 */
export async function getResourceInputSchema(
  apiUrl: string,
  resourceId: string
): Promise<JsonObject> {
  const resource = await inspectResource(apiUrl, resourceId);
  return resource.inputSchema;
}

/**
 * Get resource output schema
 */
export async function getResourceOutputSchema(
  apiUrl: string,
  resourceId: string
): Promise<JsonObject> {
  const resource = await inspectResource(apiUrl, resourceId);
  return resource.outputSchema;
}
