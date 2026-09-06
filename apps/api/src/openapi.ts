import { serviceName } from "@lumenbazaar/shared";

type HttpMethod = "get" | "post" | "patch" | "delete";
type SchemaObject = Record<string, unknown>;

type RouteContract = {
  method: HttpMethod;
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  requestBody?: SchemaObject;
  response: SchemaObject;
};

const jsonObject: SchemaObject = {
  type: "object",
  additionalProperties: true
};

const errorResponse: SchemaObject = {
  type: "object",
  required: ["ok", "error"],
  properties: {
    ok: {
      type: "boolean",
      enum: [false]
    },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: {
          type: "string"
        },
        message: {
          type: "string"
        },
        details: jsonObject
      }
    },
    requestId: {
      type: "string"
    }
  }
};

const assetSchema: SchemaObject = {
  type: "object",
  required: ["code", "issuer"],
  properties: {
    code: { type: "string" },
    issuer: { type: "string" }
  }
};

const seller: SchemaObject = {
  type: "object",
  required: ["id", "displayName", "walletAddress", "domain", "domainVerifiedAt"],
  properties: {
    id: { type: "string" },
    displayName: { type: "string" },
    walletAddress: { type: "string" },
    domain: { type: "string" },
    domainVerifiedAt: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
};

const resource: SchemaObject = {
  type: "object",
  required: [
    "id",
    "sellerId",
    "type",
    "name",
    "description",
    "url",
    "routeTemplate",
    "network",
    "payTo",
    "assetCode",
    "assetIssuer",
    "amount",
    "inputSchema",
    "outputSchema",
    "extensions",
    "status"
  ],
  properties: {
    id: { type: "string" },
    sellerId: { type: "string" },
    type: { type: "string", enum: ["http", "mcp"] },
    name: { type: "string" },
    description: { type: "string" },
    url: { type: "string", format: "uri" },
    routeTemplate: { type: "string" },
    network: { type: "string", enum: ["stellar:testnet", "stellar:pubnet"] },
    payTo: { type: "string" },
    assetCode: { type: "string" },
    assetIssuer: { type: "string" },
    amount: { type: "string" },
    inputSchema: jsonObject,
    outputSchema: jsonObject,
    extensions: jsonObject,
    status: { type: "string", enum: ["draft", "active", "inactive"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
};

const paymentPayload: SchemaObject = {
  type: "object",
  required: ["scheme", "network", "asset", "amount", "payTo"],
  properties: {
    scheme: { type: "string", enum: ["exact"] },
    network: { type: "string", enum: ["stellar:testnet", "stellar:pubnet"] },
    asset: assetSchema,
    amount: { type: "string" },
    payTo: { type: "string" },
    expiresAtLedger: { type: "integer" },
    authorization: jsonObject,
    paymentHash: { type: "string" }
  }
};

const paymentRequirements: SchemaObject = {
  type: "object",
  required: ["scheme", "network", "amount", "payTo"],
  properties: {
    scheme: { type: "string", enum: ["exact"] },
    network: { type: "string", enum: ["stellar:testnet", "stellar:pubnet"] },
    asset: assetSchema,
    amount: { type: "string" },
    payTo: { type: "string" }
  }
};

const verificationRequestProperties: Record<string, unknown> = {
  paymentPayload,
  paymentRequirements,
  resourceId: { type: "string" },
  sellerId: { type: "string" },
  currentLedger: { type: "integer" }
};

const verificationRequest: SchemaObject = {
  type: "object",
  required: ["paymentPayload", "paymentRequirements"],
  properties: verificationRequestProperties
};

const paymentSessionRequired = [
  "id",
  "network",
  "buyer",
  "payTo",
  "assetCode",
  "assetIssuer",
  "assetContractId",
  "capAmount",
  "spentAmount",
  "remainingAmount",
  "contractId",
  "contractSessionId",
  "resourceHash",
  "expiresAtLedger",
  "status"
];

const paymentSessionProperties: Record<string, unknown> = {
  id: { type: "string" },
  resourceId: { type: ["string", "null"] },
  sellerId: { type: ["string", "null"] },
  network: { type: "string", enum: ["stellar:testnet", "stellar:pubnet"] },
  buyer: { type: "string" },
  payTo: { type: "string" },
  assetCode: { type: "string" },
  assetIssuer: { type: "string" },
  assetContractId: { type: "string" },
  capAmount: { type: "string" },
  spentAmount: { type: "string" },
  remainingAmount: { type: "string" },
  contractId: { type: "string" },
  contractSessionId: { type: "string" },
  resourceHash: { type: "string" },
  expiresAtLedger: { type: "integer" },
  status: { type: "string", enum: ["open", "settled"] },
  transactionHash: { type: ["string", "null"] },
  ledger: { type: ["integer", "null"] },
  usageHash: { type: ["string", "null"] },
  createdAt: { type: "string", format: "date-time" },
  updatedAt: { type: "string", format: "date-time" }
};

const paymentSession: SchemaObject = {
  type: "object",
  required: paymentSessionRequired,
  properties: paymentSessionProperties
};

const createPaymentSessionRequest: SchemaObject = {
  type: "object",
  required: ["scheme", "network", "buyer", "asset", "capAmount", "payTo", "expiresAtLedger"],
  properties: {
    scheme: { type: "string", enum: ["upto"] },
    network: { type: "string", enum: ["stellar:testnet", "stellar:pubnet"] },
    buyer: { type: "string" },
    asset: assetSchema,
    capAmount: { type: "string" },
    payTo: { type: "string" },
    resourceId: { type: "string" },
    sellerId: { type: "string" },
    expiresAtLedger: { type: "integer" },
    currentLedger: { type: "integer" }
  }
};

const settlePaymentSessionRequest: SchemaObject = {
  type: "object",
  required: ["amount", "usageHash"],
  properties: {
    amount: { type: "string" },
    usageHash: { type: "string" },
    currentLedger: { type: "integer" }
  }
};

const settledPaymentSession: SchemaObject = {
  type: "object",
  required: ["scheme", "id", "status", "settlementId", "transactionHash", "ledger"],
  properties: {
    ...paymentSessionProperties,
    scheme: { type: "string", enum: ["upto"] },
    settlementId: { type: "string" },
    settledAt: { type: "string", format: "date-time" }
  }
};

const conformanceRun: SchemaObject = {
  type: "object",
  required: ["id", "network", "suite", "status", "results", "startedAt", "completedAt"],
  properties: {
    id: { type: "string" },
    network: { type: "string", enum: ["stellar:testnet", "stellar:pubnet"] },
    suite: { type: "string", enum: ["stellar-x402"] },
    status: { type: "string", enum: ["passed", "failed"] },
    passedCount: { type: "integer" },
    failedCount: { type: "integer" },
    reservedCount: { type: "integer" },
    exactResults: { type: "integer" },
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "scheme", "endpoint", "method", "status", "passed"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          scheme: { type: "string", enum: ["exact", "upto"] },
          endpoint: { type: "string" },
          method: { type: "string", enum: ["GET", "POST"] },
          status: { type: "string", enum: ["passed", "failed", "reserved"] },
          passed: { type: "boolean" },
          durationMs: { type: "integer" },
          details: jsonObject,
          error: { type: "string" }
        }
      }
    },
    startedAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" }
  }
};

export const apiRouteContracts: RouteContract[] = [
  {
    method: "get",
    path: "/health",
    operationId: "getHealth",
    summary: "Return API health and dependency configuration.",
    tags: ["metadata"],
    response: jsonObject
  },
  {
    method: "get",
    path: "/version",
    operationId: "getVersion",
    summary: "Return backend version and environment.",
    tags: ["metadata"],
    response: jsonObject
  },
  {
    method: "get",
    path: "/v1/networks",
    operationId: "listNetworks",
    summary: "List configured Stellar networks and assets.",
    tags: ["metadata"],
    response: jsonObject
  },
  {
    method: "get",
    path: "/v1/supported",
    operationId: "listSupportedPaymentSchemes",
    summary: "List supported x402 payment schemes.",
    tags: ["facilitator"],
    response: jsonObject
  },
  {
    method: "post",
    path: "/v1/verify",
    operationId: "verifyPayment",
    summary: "Verify an exact Stellar x402 payment payload.",
    tags: ["facilitator"],
    requestBody: verificationRequest,
    response: jsonObject
  },
  {
    method: "post",
    path: "/v1/settle",
    operationId: "settlePayment",
    summary: "Settle a previously verified exact Stellar x402 payment.",
    tags: ["facilitator"],
    requestBody: {
      type: "object",
      required: ["paymentAttemptId", "paymentPayload", "paymentRequirements"],
      properties: {
        paymentAttemptId: { type: "string" },
        ...verificationRequestProperties
      }
    },
    response: jsonObject
  },
  {
    method: "get",
    path: "/v1/receipts/{receiptId}",
    operationId: "getReceipt",
    summary: "Fetch a settlement receipt.",
    tags: ["facilitator"],
    response: jsonObject
  },
  {
    method: "post",
    path: "/v1/payment-sessions",
    operationId: "createPaymentSession",
    summary: "Create a capped Stellar upto payment session.",
    tags: ["facilitator"],
    requestBody: createPaymentSessionRequest,
    response: paymentSession
  },
  {
    method: "get",
    path: "/v1/payment-sessions/{sessionId}",
    operationId: "getPaymentSession",
    summary: "Fetch a capped payment session.",
    tags: ["facilitator"],
    response: paymentSession
  },
  {
    method: "post",
    path: "/v1/payment-sessions/{sessionId}/settle",
    operationId: "settlePaymentSession",
    summary: "Settle a capped payment session up to its authorized amount.",
    tags: ["facilitator"],
    requestBody: settlePaymentSessionRequest,
    response: settledPaymentSession
  },
  {
    method: "post",
    path: "/v1/sellers",
    operationId: "createSeller",
    summary: "Create a seller profile.",
    tags: ["sellers"],
    requestBody: {
      type: "object",
      required: ["displayName", "walletAddress", "domain"],
      properties: {
        displayName: { type: "string" },
        walletAddress: { type: "string" },
        domain: { type: "string" }
      }
    },
    response: seller
  },
  {
    method: "get",
    path: "/v1/sellers/{sellerId}",
    operationId: "getSeller",
    summary: "Fetch a seller profile.",
    tags: ["sellers"],
    response: seller
  },
  {
    method: "post",
    path: "/v1/sellers/{sellerId}/verify-domain",
    operationId: "verifySellerDomain",
    summary: "Create or complete a seller domain verification challenge.",
    tags: ["sellers"],
    requestBody: jsonObject,
    response: jsonObject
  },
  {
    method: "get",
    path: "/v1/resources",
    operationId: "listResources",
    summary: "List catalog resources.",
    tags: ["resources"],
    response: {
      type: "object",
      required: ["resources", "nextCursor"],
      properties: {
        resources: {
          type: "array",
          items: resource
        },
        nextCursor: { type: ["string", "null"] }
      }
    }
  },
  {
    method: "post",
    path: "/v1/resources",
    operationId: "createResource",
    summary: "Create a paid resource owned by a seller.",
    tags: ["resources"],
    requestBody: resource,
    response: resource
  },
  {
    method: "get",
    path: "/v1/resources/{id}",
    operationId: "getResource",
    summary: "Fetch a paid resource by ID.",
    tags: ["resources"],
    response: resource
  },
  {
    method: "patch",
    path: "/v1/resources/{id}",
    operationId: "updateResource",
    summary: "Update mutable paid resource fields.",
    tags: ["resources"],
    requestBody: resource,
    response: resource
  },
  {
    method: "delete",
    path: "/v1/resources/{id}",
    operationId: "deleteResource",
    summary: "Deactivate a paid resource.",
    tags: ["resources"],
    response: resource
  },
  {
    method: "get",
    path: "/v1/sellers/{sellerId}/resources",
    operationId: "listSellerResources",
    summary: "List resources owned by a seller.",
    tags: ["resources"],
    response: jsonObject
  },
  {
    method: "get",
    path: "/v1/discovery/resources",
    operationId: "browseDiscoveryResources",
    summary: "Browse discoverable paid resources.",
    tags: ["discovery"],
    response: jsonObject
  },
  {
    method: "get",
    path: "/v1/discovery/search",
    operationId: "searchDiscoveryResources",
    summary: "Search paid resources by query and filters.",
    tags: ["discovery"],
    response: jsonObject
  },
  {
    method: "post",
    path: "/v1/discovery/validate",
    operationId: "validateDiscoveryMetadata",
    summary: "Validate Bazaar discovery metadata without cataloging it.",
    tags: ["discovery"],
    requestBody: jsonObject,
    response: jsonObject
  },
  {
    method: "post",
    path: "/v1/discovery/catalog",
    operationId: "catalogDiscoveryMetadata",
    summary: "Catalog valid Bazaar discovery metadata.",
    tags: ["discovery"],
    requestBody: jsonObject,
    response: jsonObject
  },
  {
    method: "post",
    path: "/v1/conformance/runs",
    operationId: "createConformanceRun",
    summary: "Run backend x402 conformance checks and persist the result.",
    tags: ["conformance"],
    requestBody: {
      type: "object",
      properties: {
        network: { type: "string", enum: ["stellar:testnet", "stellar:pubnet"] },
        includeReserved: { type: "boolean", default: true }
      }
    },
    response: conformanceRun
  },
  {
    method: "get",
    path: "/v1/conformance/runs",
    operationId: "listConformanceRuns",
    summary: "List persisted conformance runs.",
    tags: ["conformance"],
    response: {
      type: "array",
      items: conformanceRun
    }
  },
  {
    method: "get",
    path: "/v1/conformance/runs/{runId}",
    operationId: "getConformanceRun",
    summary: "Fetch a persisted conformance run.",
    tags: ["conformance"],
    response: conformanceRun
  }
];

export const apiOpenApiSpec = buildOpenApiSpec();

export function buildOpenApiSpec() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const contract of apiRouteContracts) {
    const pathItem = (paths[contract.path] ??= {});
    pathItem[contract.method] = {
      operationId: contract.operationId,
      summary: contract.summary,
      tags: contract.tags,
      ...(contract.requestBody === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: contract.requestBody
                }
              }
            }
          }),
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: contract.response
            }
          }
        },
        default: {
          description: "Error response",
          content: {
            "application/json": {
              schema: errorResponse
            }
          }
        }
      }
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "LumenBazaar Backend API",
      version: "0.1.0",
      description: "Facilitator, seller catalog, discovery, and conformance APIs for LumenBazaar."
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development"
      }
    ],
    tags: [...new Set(apiRouteContracts.flatMap((contract) => contract.tags))].map((name) => ({
      name
    })),
    paths,
    "x-docs-consumption": {
      source: `${serviceName}/docs/api/openapi.json`,
      markdown: `${serviceName}/docs/api/openapi.md`
    }
  };
}

export function renderOpenApiMarkdown(spec: ReturnType<typeof buildOpenApiSpec> = apiOpenApiSpec) {
  const lines = [
    "# LumenBazaar Backend API",
    "",
    "Generated from `apps/api/src/openapi.ts`. Do not edit this file manually.",
    "",
    `OpenAPI version: ${spec.openapi}`,
    `API version: ${spec.info.version}`,
    "",
    "## Endpoints",
    "",
    "| Method | Path | Summary |",
    "| --- | --- | --- |"
  ];

  for (const contract of apiRouteContracts) {
    lines.push(`| ${contract.method.toUpperCase()} | \`${contract.path}\` | ${contract.summary} |`);
  }

  lines.push(
    "",
    "## Docs Repo Consumption",
    "",
    "- Import `docs/api/openapi.json` for machine-readable API contracts.",
    "- Import `docs/api/openapi.md` for a human-readable endpoint summary."
  );

  return `${lines.join("\n")}\n`;
}
