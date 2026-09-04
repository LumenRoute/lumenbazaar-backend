import { z } from "zod";

/**
 * Tool definitions and input/output schemas for MCP server
 */

export const toolDefinitions = [
  {
    name: "list_supported_networks",
    description: "List all supported Stellar networks (testnet and pubnet) with asset configurations",
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({
      networks: z.array(
        z.object({
          id: z.string().describe("Network identifier (stellar:testnet or stellar:pubnet)"),
          name: z.string().describe("Display name for the network"),
          chain: z.string().describe("Blockchain identifier")
        })
      )
    })
  },
  {
    name: "search_paid_resources",
    description: "Search for paid HTTP endpoints and MCP tools across the Bazaar",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe("Natural language search query (e.g., 'weather API', 'data retrieval')"),
      type: z
        .enum(["http", "mcp"])
        .optional()
        .describe("Filter by resource type: http endpoints or mcp tools"),
      network: z
        .enum(["stellar:testnet", "stellar:pubnet"])
        .optional()
        .describe("Filter by payment network"),
      asset: z
        .string()
        .optional()
        .describe("Filter by asset code (e.g., USDC)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Number of results to return"),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor for next batch of results")
    }),
    outputSchema: z.object({
      resources: z.array(
        z.object({
          id: z.string().describe("Unique resource identifier"),
          name: z.string().describe("Resource name"),
          description: z.string().describe("Resource description"),
          type: z.enum(["http", "mcp"]).describe("Resource type"),
          url: z.string().describe("Resource URL or endpoint"),
          paymentTerms: z.object({
            scheme: z.enum(["exact", "upto"]),
            network: z.enum(["stellar:testnet", "stellar:pubnet"]),
            asset: z.object({
              code: z.string(),
              issuer: z.string()
            }),
            amount: z.string().describe("Price in stroops or smallest unit"),
            payTo: z.string().describe("Payment recipient address")
          })
        })
      ),
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor for next batch"),
      total: z.number().optional().describe("Total number of matching resources")
    })
  },
  {
    name: "inspect_resource",
    description: "Get detailed information about a specific resource including input/output schemas and payment terms",
    inputSchema: z.object({
      resourceId: z.string().describe("The resource ID to inspect")
    }),
    outputSchema: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.enum(["http", "mcp"]),
      url: z.string(),
      routeTemplate: z
        .string()
        .optional()
        .describe("For HTTP endpoints: route pattern with {param} placeholders"),
      inputSchema: z.record(z.string(), z.unknown()).describe("JSON schema for request payload"),
      outputSchema: z.record(z.string(), z.unknown()).describe("JSON schema for response payload"),
      paymentTerms: z.object({
        scheme: z.enum(["exact", "upto"]),
        network: z.enum(["stellar:testnet", "stellar:pubnet"]),
        asset: z.object({
          code: z.string(),
          issuer: z.string()
        }),
        amount: z.string(),
        payTo: z.string()
      })
    })
  }
];

export type ToolName = (typeof toolDefinitions)[number]["name"];

export function getToolDefinition(name: string) {
  return toolDefinitions.find((t) => t.name === name);
}

export function listToolDefinitions() {
  return toolDefinitions;
}
