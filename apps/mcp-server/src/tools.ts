import { z } from "zod";

/**
 * Tool definitions and input/output schemas for MCP server
 */

export const toolDefinitions = [
  {
    name: "list_supported_networks",
    description:
      "List all supported Stellar networks (testnet and pubnet) with asset configurations",
    jsonInputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
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
    jsonInputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query"
        },
        type: {
          enum: ["http", "mcp"],
          description: "Resource type"
        },
        network: {
          enum: ["stellar:testnet", "stellar:pubnet"],
          description: "Payment network"
        },
        asset: {
          type: "string",
          description: "Asset code"
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "Result limit"
        },
        cursor: {
          type: "string",
          description: "Pagination cursor"
        }
      },
      additionalProperties: false
    },
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
      asset: z.string().optional().describe("Filter by asset code (e.g., USDC)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Number of results to return"),
      cursor: z.string().optional().describe("Pagination cursor for next batch of results")
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
      cursor: z.string().optional().describe("Pagination cursor for next batch"),
      total: z.number().optional().describe("Total number of matching resources")
    })
  },
  {
    name: "inspect_resource",
    description:
      "Get detailed information about a specific resource including input/output schemas and payment terms",
    jsonInputSchema: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description: "The resource ID to inspect"
        }
      },
      required: ["resourceId"],
      additionalProperties: false
    },
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
  },
  {
    name: "prepare_payment",
    description: "Prepare an exact Stellar x402 payment payload for a paid resource",
    jsonInputSchema: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description: "Resource ID to pay for"
        },
        expiresAtLedger: {
          type: "number",
          description: "Optional ledger sequence where the authorization expires"
        },
        authorization: {
          type: "object",
          description: "Optional wallet authorization payload"
        }
      },
      required: ["resourceId"],
      additionalProperties: false
    },
    inputSchema: z.object({
      resourceId: z.string().min(1),
      expiresAtLedger: z.number().int().positive().optional(),
      authorization: z.record(z.string(), z.unknown()).optional()
    }),
    outputSchema: z.object({
      resourceId: z.string(),
      paymentPayload: z.record(z.string(), z.unknown()),
      paymentRequirements: z.record(z.string(), z.unknown()),
      budget: z.record(z.string(), z.unknown())
    })
  },
  {
    name: "call_paid_resource",
    description: "Verify payment, call a paid resource, settle it, and return receipt details",
    jsonInputSchema: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description: "Resource ID to call"
        },
        resourceUrl: {
          type: "string",
          description: "Optional override URL for local tests"
        },
        paymentPayload: {
          type: "object",
          description: "Optional prepared payment payload"
        },
        authorization: {
          type: "object",
          description: "Optional wallet authorization payload"
        },
        currentLedger: {
          type: "number",
          description: "Current ledger for expiry checks"
        },
        expiresAtLedger: {
          type: "number",
          description: "Optional authorization expiry ledger"
        },
        maxRetries: {
          type: "number",
          description: "Maximum paid endpoint retry attempts"
        },
        retryDelayMs: {
          type: "number",
          description: "Base retry delay in milliseconds"
        },
        timeoutMs: {
          type: "number",
          description: "Paid endpoint timeout in milliseconds"
        }
      },
      required: ["resourceId"],
      additionalProperties: false
    },
    inputSchema: z.object({
      resourceId: z.string().min(1),
      resourceUrl: z.string().url().optional(),
      paymentPayload: z.record(z.string(), z.unknown()).optional(),
      authorization: z.record(z.string(), z.unknown()).optional(),
      currentLedger: z.number().int().nonnegative().optional(),
      expiresAtLedger: z.number().int().positive().optional(),
      maxRetries: z.number().int().min(0).max(10).optional(),
      retryDelayMs: z.number().int().min(0).max(60_000).optional(),
      timeoutMs: z.number().int().min(1).max(300_000).optional()
    }),
    outputSchema: z.record(z.string(), z.unknown())
  },
  {
    name: "get_payment_receipt",
    description: "Fetch a LumenBazaar payment receipt by ID",
    jsonInputSchema: {
      type: "object",
      properties: {
        receiptId: {
          type: "string",
          description: "Receipt ID returned by settlement"
        }
      },
      required: ["receiptId"],
      additionalProperties: false
    },
    inputSchema: z.object({
      receiptId: z.string().min(1)
    }),
    outputSchema: z.record(z.string(), z.unknown())
  },
  {
    name: "inspect_budget",
    description: "Inspect the local MCP payment budget caps and current spend",
    jsonInputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    inputSchema: z.object({}).strict(),
    outputSchema: z.record(z.string(), z.unknown())
  }
];

export type ToolName = (typeof toolDefinitions)[number]["name"];

export function getToolDefinition(name: string) {
  return toolDefinitions.find((t) => t.name === name);
}

export function listToolDefinitions() {
  return toolDefinitions;
}
