import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { serviceName } from "@lumenbazaar/shared";

import { BackendClient } from "./client.js";
import { handleToolError } from "./errors.js";
import { listToolDefinitions } from "./tools.js";

const client = new BackendClient();

/**
 * MCP Server for LumenBazaar
 * Provides tools for discovering and calling paid resources
 */
const server = new Server({
  name: "lumenbazaar",
  version: "0.1.0"
});

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = listToolDefinitions().map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        type: { enum: ["http", "mcp"], description: "Resource type" },
        network: { enum: ["stellar:testnet", "stellar:pubnet"], description: "Network" },
        asset: { type: "string", description: "Asset code" },
        limit: { type: "number", description: "Result limit" },
        cursor: { type: "string", description: "Pagination cursor" },
        resourceId: { type: "string", description: "Resource ID" }
      }
    }
  }));

  return { tools };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request: unknown) => {
  const req = request as { params: { name: string; arguments?: Record<string, unknown> } };
  const toolName = req.params.name;
  const toolInput = (req.params.arguments as Record<string, unknown>) || {};

  try {
    let result: Record<string, unknown>;

    switch (toolName) {
      case "list_supported_networks": {
        const networks = await client.listNetworks();
        result = {
          networks: networks.map((n) => ({
            id: n.id,
            name: n.name,
            chain: n.chain
          }))
        };
        break;
      }

      case "search_paid_resources": {
        const searchParams = {
          q: toolInput.query as string | undefined,
          type: toolInput.type as "http" | "mcp" | undefined,
          network: toolInput.network as string | undefined,
          asset: toolInput.asset as string | undefined,
          limit: toolInput.limit as number | undefined,
          cursor: toolInput.cursor as string | undefined
        };

        // Filter undefined values
        const params: {
          q?: string;
          type?: "http" | "mcp";
          network?: string;
          asset?: string;
          limit?: number;
          cursor?: string;
        } = {};
        if (searchParams.q !== undefined) params.q = searchParams.q;
        if (searchParams.type !== undefined) params.type = searchParams.type;
        if (searchParams.network !== undefined) params.network = searchParams.network;
        if (searchParams.asset !== undefined) params.asset = searchParams.asset;
        if (searchParams.limit !== undefined) params.limit = searchParams.limit;
        if (searchParams.cursor !== undefined) params.cursor = searchParams.cursor;

        const response = await client.searchResources(params);
        result = {
          resources: response.resources.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            type: r.type,
            url: r.url,
            paymentTerms: r.paymentTerms
          }))
        };
        if (response.cursor !== undefined) {
          result.cursor = response.cursor;
        }
        if (response.total !== undefined) {
          result.total = response.total;
        }
        break;
      }

      case "inspect_resource": {
        const resourceId = toolInput.resourceId as string;
        if (!resourceId) {
          throw new Error("resourceId is required");
        }

        const resource = await client.getResource(resourceId);
        result = {
          id: resource.id,
          name: resource.name,
          description: resource.description,
          type: resource.type,
          url: resource.url
        };
        if (resource.routeTemplate !== undefined) {
          result.routeTemplate = resource.routeTemplate;
        }
        result.inputSchema = resource.inputSchema;
        result.outputSchema = resource.outputSchema;
        result.paymentTerms = resource.paymentTerms;
        break;
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    const errorInfo = handleToolError(error);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: errorInfo.code,
              message: errorInfo.message,
              details: errorInfo.details
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }
});

/**
 * Start server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${serviceName} MCP server started`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

