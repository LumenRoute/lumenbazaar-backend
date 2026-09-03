import { z } from "zod";

import { type JsonObject } from "@lumenbazaar/shared";

const jsonObjectSchema = z.record(z.string(), z.unknown());

const baseResourceMetadataSchema = z.object({
  type: z.enum(["http", "mcp"]),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000),
  url: z.string().url(),
  routeTemplate: z.string().min(1),
  network: z.enum(["stellar:testnet", "stellar:pubnet"]),
  payTo: z.string().min(1),
  assetCode: z.string().min(1).max(12),
  assetIssuer: z.string().min(1),
  amount: z.string().min(1),
  inputSchema: jsonObjectSchema,
  outputSchema: jsonObjectSchema,
  extensions: jsonObjectSchema.default({})
});

export const discoveryMetadataSchema = z
  .object({
    metadataVersion: z.literal(1).default(1),
    sellerId: z.string().min(1),
    resource: baseResourceMetadataSchema
  })
  .superRefine((value, context) => {
    if (value.resource.type === "mcp") {
      const mcp = value.resource.extensions.mcp;

      if (!isRecord(mcp) || typeof mcp.toolName !== "string" || mcp.toolName.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["resource", "extensions", "mcp"],
          message: "MCP resources require extensions.mcp.toolName."
        });
      }
    }
  });

export type DiscoveryMetadata = z.output<typeof discoveryMetadataSchema>;

export function parseDiscoveryMetadata(input: unknown): DiscoveryMetadata {
  return discoveryMetadataSchema.parse(input);
}

export function toResourceCreateInput(metadata: DiscoveryMetadata) {
  return {
    sellerId: metadata.sellerId,
    ...metadata.resource,
    inputSchema: metadata.resource.inputSchema as JsonObject,
    outputSchema: metadata.resource.outputSchema as JsonObject,
    extensions: metadata.resource.extensions as JsonObject
  };
}

export function metadataResourceKind(metadata: DiscoveryMetadata) {
  return metadata.resource.type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
