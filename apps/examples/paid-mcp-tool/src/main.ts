import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";

import { type PaymentPayload } from "@lumenbazaar/buyer-sdk";
import { McpPaymentToolService } from "@lumenbazaar/mcp-server";
import {
  mcpResource,
  paymentRequirement,
  sendFastifyPaymentRequired
} from "@lumenbazaar/seller-sdk";
import { localIssuerPublicKey, serviceName, type JsonObject } from "@lumenbazaar/shared";

const testAssetContractId = "CB256KDRXDO2FYJN3YBYZE5KCU46WIIE67DRP5T7HI45DRH2GM6YOJFS";

export const paidMcpToolName = "quote_price";
export const paidMcpServerName = "lumenbazaar-examples";

export const paidMcpToolInputSchema: JsonObject = {
  type: "object",
  properties: {
    sku: {
      type: "string",
      minLength: 1,
      description: "Catalog SKU to quote."
    },
    quantity: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 1
    }
  },
  required: ["sku"],
  additionalProperties: false
};

export const paidMcpToolOutputSchema: JsonObject = {
  type: "object",
  properties: {
    sku: {
      type: "string"
    },
    quantity: {
      type: "integer"
    },
    unitPrice: {
      type: "number"
    },
    total: {
      type: "number"
    },
    currency: {
      type: "string"
    },
    paid: {
      type: "boolean"
    }
  },
  required: ["sku", "quantity", "unitPrice", "total", "currency", "paid"],
  additionalProperties: false
};

export const paidMcpToolRequestSchema = z.object({
  sku: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(100).default(1)
});

export type PaidMcpToolRequest = z.output<typeof paidMcpToolRequestSchema>;

export type PaidMcpToolResult = {
  currency: "USD";
  paid: true;
  quantity: number;
  sku: string;
  total: number;
  unitPrice: number;
};

export type PaidMcpToolCatalogOptions = {
  baseUrl?: string;
  sellerId?: string;
};

export type PaidMcpToolExampleOptions = PaidMcpToolCatalogOptions & {
  logger?: boolean;
};

export type RegisterPaidMcpToolOptions = Required<PaidMcpToolCatalogOptions> & {
  apiUrl: string;
  fetchImpl?: typeof fetch;
};

export type CallPaidMcpToolOptions = {
  apiUrl: string;
  input: PaidMcpToolRequest;
  paymentPayload: PaymentPayload;
  resourceId: string;
  serverBaseUrl?: string;
};

export const paidMcpPaymentRequirement = paymentRequirement({
  network: "stellar:testnet",
  assetContractId: testAssetContractId,
  assetCode: "USDC",
  assetIssuer: localIssuerPublicKey,
  amount: "300000",
  payTo: localIssuerPublicKey
});

export const paidMcpToolMetadata = mcpResource({
  name: "Paid Quote MCP Tool",
  description: "Returns a deterministic SKU quote after an exact x402 payment.",
  url: "https://mcp.example.test/tools/quote_price",
  routeTemplate: `mcp://${paidMcpServerName}/${paidMcpToolName}`,
  inputSchema: paidMcpToolInputSchema,
  outputSchema: paidMcpToolOutputSchema,
  trusted: false
});

export function createPaidMcpToolCatalogMetadata(options: PaidMcpToolCatalogOptions = {}) {
  const baseUrl = options.baseUrl ?? "https://mcp.example.test";
  const sellerId = options.sellerId ?? "seller_mcp_tool_example";

  return {
    metadataVersion: 1 as const,
    sellerId,
    resource: {
      ...paidMcpToolMetadata.resource,
      url: `${baseUrl.replace(/\/$/, "")}/tools/${paidMcpToolName}`,
      network: paidMcpPaymentRequirement.network,
      payTo: paidMcpPaymentRequirement.payTo,
      assetCode: "USDC",
      assetIssuer: localIssuerPublicKey,
      amount: "0.03",
      extensions: {
        ...paidMcpToolMetadata.resource.extensions,
        bazaar: true,
        example: "paid-mcp-tool",
        assetContractId: paidMcpPaymentRequirement.asset,
        mcp: {
          serverName: paidMcpServerName,
          toolName: paidMcpToolName,
          transport: "http-bridge"
        },
        testnet: true
      }
    }
  };
}

export function createPaidMcpToolApp(options: PaidMcpToolExampleOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const metadata = createPaidMcpToolCatalogMetadata(options);

  app.get("/.well-known/lumenbazaar.json", async () => metadata);
  app.get("/metadata", async () => metadata);

  app.post(`/tools/${paidMcpToolName}`, async (request, reply) => {
    const parsed = paidMcpToolRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid MCP tool arguments",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    if (!hasPaymentHeader(request)) {
      return sendFastifyPaymentRequired(reply, paidMcpPaymentRequirement);
    }

    return runPaidMcpTool(parsed.data);
  });

  return app;
}

export async function registerPaidMcpToolInDiscovery(options: RegisterPaidMcpToolOptions) {
  const response = await (options.fetchImpl ?? fetch)(
    `${options.apiUrl.replace(/\/$/, "")}/v1/discovery/catalog`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        createPaidMcpToolCatalogMetadata({
          baseUrl: options.baseUrl,
          sellerId: options.sellerId
        })
      )
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to register paid MCP tool: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<JsonObject>;
}

export async function callPaidMcpToolThroughLumenBazaar(options: CallPaidMcpToolOptions) {
  const service = new McpPaymentToolService({ apiUrl: options.apiUrl });
  const baseUrl = (options.serverBaseUrl ?? "https://mcp.example.test").replace(/\/$/, "");

  return service.callPaidResource({
    body: options.input,
    resourceId: options.resourceId,
    paymentPayload: options.paymentPayload,
    resourceUrl: `${baseUrl}/tools/${paidMcpToolName}`
  });
}

export function runPaidMcpTool(input: PaidMcpToolRequest): PaidMcpToolResult {
  const unitPrice = quoteUnitPrice(input.sku);

  return {
    currency: "USD",
    paid: true,
    quantity: input.quantity,
    sku: input.sku,
    total: Number((unitPrice * input.quantity).toFixed(2)),
    unitPrice
  };
}

export async function startPaidMcpToolExample() {
  const app = createPaidMcpToolApp({ logger: true });
  const port = Number(process.env.PORT ?? 4030);
  await app.listen({ host: "0.0.0.0", port });
  console.log(`${serviceName} paid MCP tool example listening on ${port}`);
}

function quoteUnitPrice(sku: string) {
  const seed = [...sku].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return Number((12 + (seed % 25) + (seed % 7) / 10).toFixed(2));
}

function hasPaymentHeader(request: FastifyRequest) {
  return typeof request.headers["payment-signature"] === "string";
}

if (process.env.NODE_ENV !== "test") {
  startPaidMcpToolExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
