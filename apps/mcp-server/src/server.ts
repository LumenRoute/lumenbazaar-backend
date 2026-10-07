import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import type { PaymentPayload } from "@lumenbazaar/buyer-sdk";

import { BackendClient } from "./client.js";
import { handleToolError } from "./errors.js";
import { McpPaymentToolService } from "./paymentTools.js";
import { getToolDefinition, listToolDefinitions } from "./tools.js";

export type CreateMcpServerOptions = {
  client?: BackendClient;
  paymentTools?: McpPaymentToolService;
};

export function createMcpServer(options: CreateMcpServerOptions = {}) {
  const client = options.client ?? new BackendClient();
  const paymentTools = options.paymentTools ?? new McpPaymentToolService({ client });
  const server = new Server(
    {
      name: "lumenbazaar",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = listToolDefinitions().map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.jsonInputSchema
    }));

    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: unknown) => {
    const req = request as { params: { name: string; arguments?: Record<string, unknown> } };
    const toolName = req.params.name;

    try {
      const toolDefinition = getToolDefinition(toolName);

      if (toolDefinition === undefined) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      const toolInput = toolDefinition.inputSchema.parse(req.params.arguments ?? {}) as Record<
        string,
        unknown
      >;
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

        case "prepare_payment": {
          result = await paymentTools.preparePayment({
            resourceId: toolInput.resourceId as string
          });
          break;
        }

        case "call_paid_resource": {
          result = await paymentTools.callPaidResource({
            ...(toolInput.body === undefined
              ? {}
              : { body: toolInput.body as Record<string, unknown> }),
            ...(toolInput.maxRetries === undefined
              ? {}
              : { maxRetries: toolInput.maxRetries as number }),
            ...(toolInput.method === undefined
              ? {}
              : { method: toolInput.method as "GET" | "POST" }),
            paymentPayload: toolInput.paymentPayload as PaymentPayload,
            ...(toolInput.resourceUrl === undefined
              ? {}
              : { resourceUrl: toolInput.resourceUrl as string }),
            ...(toolInput.retryDelayMs === undefined
              ? {}
              : { retryDelayMs: toolInput.retryDelayMs as number }),
            ...(toolInput.timeoutMs === undefined
              ? {}
              : { timeoutMs: toolInput.timeoutMs as number }),
            resourceId: toolInput.resourceId as string
          });
          break;
        }

        case "get_payment_receipt": {
          result = await paymentTools.getPaymentReceipt({
            receiptId: toolInput.receiptId as string
          });
          break;
        }

        case "inspect_budget": {
          result = paymentTools.inspectBudget();
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

  return server;
}
