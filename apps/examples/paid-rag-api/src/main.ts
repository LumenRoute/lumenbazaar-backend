import Fastify, { type FastifyRequest } from "fastify";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  httpResource,
  paymentRequirement,
  sendFastifyPaymentRequired,
  type PaymentRequirement
} from "@lumenbazaar/seller-sdk";
import { localIssuerPublicKey, serviceName, type JsonObject } from "@lumenbazaar/shared";

const testAssetContractId = "CB256KDRXDO2FYJN3YBYZE5KCU46WIIE67DRP5T7HI45DRH2GM6YOJFS";

const defaultTopK = 3;
const maxTopK = 8;

export const ragInputSchema: JsonObject = {
  type: "object",
  properties: {
    question: {
      type: "string",
      minLength: 1,
      description: "Question to answer from the selected corpus."
    },
    corpus: {
      type: "string",
      enum: ["docs", "api", "contracts"],
      default: "docs"
    },
    topK: {
      type: "integer",
      minimum: 1,
      maximum: maxTopK,
      default: defaultTopK
    }
  },
  required: ["question"],
  additionalProperties: false
};

export const ragOutputSchema: JsonObject = {
  type: "object",
  properties: {
    answer: {
      type: "string"
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string"
          },
          title: {
            type: "string"
          },
          score: {
            type: "number"
          }
        },
        required: ["id", "title", "score"],
        additionalProperties: false
      }
    },
    paid: {
      type: "boolean"
    },
    pricing: {
      type: "object"
    }
  },
  required: ["answer", "citations", "paid", "pricing"],
  additionalProperties: false
};

export const ragRequestSchema = z.object({
  question: z.string().trim().min(1),
  corpus: z.enum(["docs", "api", "contracts"]).default("docs"),
  topK: z.number().int().min(1).max(maxTopK).default(defaultTopK)
});

export type RagRequest = z.output<typeof ragRequestSchema>;

export type RagAnswer = {
  answer: string;
  citations: Array<{
    id: string;
    score: number;
    title: string;
  }>;
  paid: true;
  pricing: {
    amount: string;
    model: "per-request";
    network: "stellar:testnet" | "stellar:pubnet";
  };
};

export type RagCatalogOptions = {
  baseUrl?: string;
  sellerId?: string;
};

export type RagExampleOptions = RagCatalogOptions & {
  logger?: boolean;
};

export type VerifyRagReceiptOptions = {
  apiUrl: string;
  expectedAmount?: string;
  expectedResourceId?: string;
  fetchImpl?: typeof fetch;
  receiptId: string;
};

export const ragResourceMetadata = httpResource({
  name: "Paid RAG API",
  description: "Answers questions from a deterministic demo corpus after an exact x402 payment.",
  url: "https://rag.example.test/rag/query",
  routeTemplate: "/rag/query",
  inputSchema: ragInputSchema,
  outputSchema: ragOutputSchema,
  trusted: false
});

export function createRagPaymentRequirement(input: unknown): PaymentRequirement {
  const parsed = ragRequestSchema.safeParse(input);
  const topK = parsed.success ? parsed.data.topK : defaultTopK;

  return paymentRequirement({
    network: "stellar:testnet",
    assetContractId: testAssetContractId,
    assetCode: "USDC",
    assetIssuer: localIssuerPublicKey,
    amount: String((5 + topK) * 100_000),
    payTo: localIssuerPublicKey
  });
}

export function createRagCatalogMetadata(options: RagCatalogOptions = {}) {
  const baseUrl = options.baseUrl ?? "https://rag.example.test";
  const sellerId = options.sellerId ?? "seller_rag_example";
  const defaultRequirement = createRagPaymentRequirement({
    question: "What is LumenBazaar?",
    topK: defaultTopK
  });

  return {
    metadataVersion: 1 as const,
    sellerId,
    resource: {
      ...ragResourceMetadata.resource,
      url: `${baseUrl.replace(/\/$/, "")}/rag/query`,
      network: defaultRequirement.network,
      payTo: defaultRequirement.payTo,
      assetCode: "USDC",
      assetIssuer: localIssuerPublicKey,
      amount: formatCents(5 + defaultTopK),
      extensions: {
        ...ragResourceMetadata.resource.extensions,
        bazaar: true,
        example: "paid-rag-api",
        assetContractId: defaultRequirement.asset,
        pricing: {
          baseAmount: "0.05",
          defaultAmount: formatCents(5 + defaultTopK),
          defaultTopK,
          model: "per-request",
          topKIncrement: "0.01",
          maxTopK
        },
        testnet: true
      }
    }
  };
}

export function createRagApp(options: RagExampleOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const metadata = createRagCatalogMetadata(options);

  app.get("/.well-known/lumenbazaar.json", async () => metadata);
  app.get("/metadata", async () => metadata);

  app.post("/rag/query", async (request, reply) => {
    const parsed = ragRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid RAG request",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    const paymentRequirement = createRagPaymentRequirement(parsed.data);

    if (!hasPaymentHeader(request)) {
      return sendFastifyPaymentRequired(reply, paymentRequirement);
    }

    return answerRagRequest(parsed.data, paymentRequirement);
  });

  return app;
}

export async function verifyRagReceipt(options: VerifyRagReceiptOptions) {
  const response = await (options.fetchImpl ?? fetch)(
    `${options.apiUrl.replace(/\/$/, "")}/v1/receipts/${options.receiptId}`,
    {
      method: "GET"
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to verify RAG receipt: ${response.status} ${response.statusText}`);
  }

  const receipt = (await response.json()) as Record<string, unknown>;
  const statusOk = receipt.status === "finalized";
  const resourceOk =
    options.expectedResourceId === undefined || receipt.resourceId === options.expectedResourceId;
  const amountOk =
    options.expectedAmount === undefined || receipt.amount === options.expectedAmount;

  return {
    ok: statusOk && resourceOk && amountOk,
    receiptId: options.receiptId,
    status: String(receipt.status ?? "unknown"),
    transactionHash:
      typeof receipt.transactionHash === "string" ? receipt.transactionHash : undefined,
    ledger: typeof receipt.ledger === "number" ? receipt.ledger : undefined,
    resourceId: typeof receipt.resourceId === "string" ? receipt.resourceId : undefined,
    amount: typeof receipt.amount === "string" ? receipt.amount : undefined
  };
}

export async function startRagExample() {
  const app = createRagApp({ logger: true });
  const port = Number(process.env.PORT ?? 4020);
  await app.listen({ host: "0.0.0.0", port });
  console.log(`${serviceName} paid RAG API example listening on ${port}`);
}

function answerRagRequest(input: RagRequest, requirement: PaymentRequirement): RagAnswer {
  const citations = corpusDocuments(input.corpus).slice(0, input.topK);

  return {
    answer: `LumenBazaar ${input.corpus} context answers: ${input.question}`,
    citations,
    paid: true,
    pricing: {
      amount: atomicToDecimal(requirement.amount),
      model: "per-request",
      network: requirement.network
    }
  };
}

function corpusDocuments(corpus: RagRequest["corpus"]) {
  return Array.from({ length: maxTopK }, (_, index) => ({
    id: `${corpus}-${index + 1}`,
    title: `${corpus.toUpperCase()} reference ${index + 1}`,
    score: Number((0.95 - index * 0.04).toFixed(2))
  }));
}

function hasPaymentHeader(request: FastifyRequest) {
  return typeof request.headers["payment-signature"] === "string";
}

function formatCents(cents: number) {
  return (cents / 100).toFixed(2);
}

function atomicToDecimal(amount: string) {
  const padded = amount.padStart(8, "0");
  const whole = padded.slice(0, -7);
  const fraction = padded.slice(-7).replace(/0+$/, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

if (
  process.env.NODE_ENV !== "test" &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startRagExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
