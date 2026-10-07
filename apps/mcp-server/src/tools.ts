import { z } from "zod";

export type McpToolCapabilities = {
  backend: boolean;
  exact: boolean;
};

export type ToolCapability = "backend" | "exact" | "local";

const paymentRequirementsSchema = z
  .object({
    scheme: z.literal("exact"),
    network: z.enum(["stellar:testnet", "stellar:pubnet"]),
    asset: z.string(),
    amount: z.string().regex(/^[1-9]\d*$/),
    payTo: z.string(),
    maxTimeoutSeconds: z.number().int().positive(),
    extra: z.record(z.string(), z.unknown())
  })
  .strict();

const paymentPayloadSchema = z
  .object({
    x402Version: z.literal(2),
    accepted: paymentRequirementsSchema,
    payload: z.object({ transaction: z.string().min(1).max(200_000) }).strict(),
    resource: z
      .object({
        url: z.string().url().max(2_048),
        description: z.string().max(2_000).optional(),
        mimeType: z.string().max(160).optional()
      })
      .strict()
      .optional()
  })
  .strict();

/**
 * Tool definitions and input/output schemas for MCP server
 */

export const toolDefinitions = [
  {
    capability: "backend" as const,
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
    capability: "backend" as const,
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
    inputSchema: z
      .object({
        query: z
          .string()
          .max(500)
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
        asset: z.string().max(12).optional().describe("Filter by asset code (e.g., USDC)"),
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
          .max(2_048)
          .optional()
          .describe("Pagination cursor for next batch of results")
      })
      .strict(),
    outputSchema: z.object({
      resources: z.array(
        z.object({
          id: z.string().describe("Unique resource identifier"),
          name: z.string().describe("Resource name"),
          description: z.string().describe("Resource description"),
          type: z.enum(["http", "mcp"]).describe("Resource type"),
          url: z.string().describe("Resource URL or endpoint"),
          paymentTerms: z.object({
            ...paymentRequirementsSchema.shape
          })
        })
      ),
      cursor: z.string().optional().describe("Pagination cursor for next batch"),
      total: z.number().optional().describe("Total number of matching resources")
    })
  },
  {
    capability: "backend" as const,
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
    inputSchema: z
      .object({
        resourceId: z.string().min(1).max(200).describe("The resource ID to inspect")
      })
      .strict(),
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
      paymentTerms: paymentRequirementsSchema
    })
  },
  {
    capability: "exact" as const,
    name: "prepare_payment",
    description: "Return exact Stellar x402 requirements for wallet signing",
    jsonInputSchema: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description: "Resource ID to pay for"
        }
      },
      required: ["resourceId"],
      additionalProperties: false
    },
    inputSchema: z.object({ resourceId: z.string().min(1).max(200) }).strict(),
    outputSchema: z.object({
      resourceId: z.string(),
      paymentRequirements: paymentRequirementsSchema,
      requiresWalletSignature: z.literal(true),
      budget: z.record(z.string(), z.unknown())
    })
  },
  {
    capability: "exact" as const,
    name: "call_paid_resource",
    description: "Verify payment, call a paid resource, settle it, and return receipt details",
    jsonInputSchema: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description: "Resource ID to call"
        },
        paymentPayload: {
          type: "object",
          description: "Wallet-signed official x402 v2 Stellar payload",
          properties: {
            x402Version: { type: "number", enum: [2] },
            accepted: {
              type: "object",
              properties: {
                scheme: { type: "string", enum: ["exact"] },
                network: { type: "string", enum: ["stellar:testnet", "stellar:pubnet"] },
                asset: { type: "string" },
                amount: { type: "string", pattern: "^[1-9]\\d*$" },
                payTo: { type: "string" },
                maxTimeoutSeconds: { type: "number" },
                extra: { type: "object" }
              },
              required: [
                "scheme",
                "network",
                "asset",
                "amount",
                "payTo",
                "maxTimeoutSeconds",
                "extra"
              ],
              additionalProperties: false
            },
            payload: {
              type: "object",
              properties: { transaction: { type: "string" } },
              required: ["transaction"],
              additionalProperties: false
            }
          },
          required: ["x402Version", "accepted", "payload"],
          additionalProperties: false
        },
        body: {
          type: "object",
          description: "Optional JSON body sent to the paid resource"
        },
        method: {
          enum: ["GET", "POST"],
          description: "HTTP method used for the paid resource call"
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
      required: ["resourceId", "paymentPayload"],
      additionalProperties: false
    },
    inputSchema: z
      .object({
        resourceId: z.string().min(1).max(200),
        paymentPayload: paymentPayloadSchema,
        body: z.record(z.string(), z.unknown()).optional(),
        method: z.enum(["GET", "POST"]).optional(),
        maxRetries: z.number().int().min(0).max(10).optional(),
        retryDelayMs: z.number().int().min(0).max(60_000).optional(),
        timeoutMs: z.number().int().min(1).max(300_000).optional()
      })
      .strict(),
    outputSchema: z.record(z.string(), z.unknown())
  },
  {
    capability: "backend" as const,
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
    inputSchema: z.object({ receiptId: z.string().min(1).max(200) }).strict(),
    outputSchema: z.record(z.string(), z.unknown())
  },
  {
    capability: "local" as const,
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

export function getToolDefinition(name: string, capabilities?: McpToolCapabilities) {
  return listToolDefinitions(capabilities).find((tool) => tool.name === name);
}

export function listToolDefinitions(
  capabilities: McpToolCapabilities = { backend: true, exact: true }
) {
  return toolDefinitions.filter((tool) => capabilityAvailable(tool.capability, capabilities));
}

function capabilityAvailable(capability: ToolCapability, capabilities: McpToolCapabilities) {
  if (capability === "local") return true;
  if (capability === "exact") return capabilities.backend && capabilities.exact;
  return capabilities.backend;
}
