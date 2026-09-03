import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  LumenError,
  type AppConfig,
  type JsonObject,
  type PaymentRequirement,
  type Resource,
  type ResourceSchema,
  type ResourceVersion,
  decodeCursor,
  encodeCursor,
  normalizeLimit,
  validateRouteTemplate
} from "@lumenbazaar/shared";
import {
  assertStellarPublicKey,
  compareExactAmounts,
  normalizeExactAmount,
  requireSupportedAsset
} from "@lumenbazaar/stellar-payments";

import { type SellerService } from "./sellers.js";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const createResourceSchema = z.object({
  sellerId: z.string().min(1),
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
  extensions: jsonObjectSchema.default({}),
  status: z.enum(["draft", "active", "inactive"]).default("active")
});

export const updateResourceSchema = createResourceSchema.partial().omit({ sellerId: true });

export const listResourcesSchema = z.object({
  sellerId: z.string().optional(),
  status: z.enum(["draft", "active", "inactive"]).optional(),
  network: z.enum(["stellar:testnet", "stellar:pubnet"]).optional(),
  asset: z.string().optional(),
  type: z.enum(["http", "mcp"]).optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
  extension: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional()
});

export type CreateResourceInput = z.output<typeof createResourceSchema>;
export type UpdateResourceInput = z.output<typeof updateResourceSchema>;
export type ListResourceFilters = z.output<typeof listResourcesSchema>;

export type ResourceStore = {
  createResource: (input: CreateResourceInput) => Promise<Resource>;
  getResource: (resourceId: string) => Promise<Resource | undefined>;
  updateResource: (resourceId: string, input: UpdateResourceInput) => Promise<Resource>;
  listResources: (
    filters: ListResourceFilters
  ) => Promise<{ resources: Resource[]; nextCursor: string | null }>;
  createVersion: (resource: Resource, metadata: JsonObject) => Promise<ResourceVersion>;
  getLatestVersion: (resourceId: string) => Promise<ResourceVersion | undefined>;
  createSchema: (resource: Resource) => Promise<ResourceSchema>;
  createPaymentRequirement: (resource: Resource) => Promise<PaymentRequirement>;
};

export class InMemoryResourceStore implements ResourceStore {
  private readonly resources = new Map<string, Resource>();
  private readonly versions = new Map<string, ResourceVersion[]>();
  private readonly schemas = new Map<string, ResourceSchema[]>();
  private readonly paymentRequirements = new Map<string, PaymentRequirement[]>();

  async createResource(input: CreateResourceInput) {
    const now = new Date().toISOString();
    const resource: Resource = {
      id: `resource_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      sellerId: input.sellerId,
      type: input.type,
      name: input.name,
      description: input.description,
      url: input.url,
      routeTemplate: input.routeTemplate,
      network: input.network,
      payTo: input.payTo,
      assetCode: input.assetCode,
      assetIssuer: input.assetIssuer,
      amount: input.amount,
      inputSchema: input.inputSchema as JsonObject,
      outputSchema: input.outputSchema as JsonObject,
      extensions: input.extensions as JsonObject,
      status: input.status,
      createdAt: now,
      updatedAt: now
    };

    this.resources.set(resource.id, resource);
    await this.createVersion(resource, resourceToMetadata(resource));
    await this.createSchema(resource);
    await this.createPaymentRequirement(resource);

    return resource;
  }

  async getResource(resourceId: string) {
    return this.resources.get(resourceId);
  }

  async updateResource(resourceId: string, input: UpdateResourceInput) {
    const existing = this.resources.get(resourceId);

    if (existing === undefined) {
      throw new LumenError("RESOURCE_NOT_FOUND", "Resource was not found.");
    }

    const updated: Resource = {
      ...existing,
      type: input.type ?? existing.type,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      url: input.url ?? existing.url,
      routeTemplate: input.routeTemplate ?? existing.routeTemplate,
      network: input.network ?? existing.network,
      payTo: input.payTo ?? existing.payTo,
      assetCode: input.assetCode ?? existing.assetCode,
      assetIssuer: input.assetIssuer ?? existing.assetIssuer,
      amount: input.amount ?? existing.amount,
      inputSchema: (input.inputSchema ?? existing.inputSchema) as JsonObject,
      outputSchema: (input.outputSchema ?? existing.outputSchema) as JsonObject,
      extensions: (input.extensions ?? existing.extensions) as JsonObject,
      status: input.status ?? existing.status,
      updatedAt: new Date().toISOString()
    };

    this.resources.set(resourceId, updated);
    await this.createVersion(updated, resourceToMetadata(updated));

    return updated;
  }

  async listResources(filters: ListResourceFilters) {
    const limit = normalizeLimit(filters.limit);
    const cursor = decodeCursor(filters.cursor);
    const filtered = [...this.resources.values()]
      .filter((resource) => resourceMatchesFilters(resource, filters))
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
    const startIndex =
      cursor === undefined ? 0 : filtered.findIndex((resource) => resource.id === cursor.id) + 1;
    const page = filtered.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + limit);
    const last = page.at(-1);

    return {
      resources: page,
      nextCursor:
        last === undefined || startIndex + limit >= filtered.length
          ? null
          : encodeCursor({ id: last.id, createdAt: last.createdAt })
    };
  }

  async createVersion(resource: Resource, metadata: JsonObject) {
    const existing = this.versions.get(resource.id) ?? [];
    const version: ResourceVersion = {
      id: `resource_version_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      resourceId: resource.id,
      version: existing.length + 1,
      metadata,
      createdAt: new Date().toISOString()
    };

    this.versions.set(resource.id, [...existing, version]);
    return version;
  }

  async getLatestVersion(resourceId: string) {
    return this.versions.get(resourceId)?.at(-1);
  }

  async createSchema(resource: Resource) {
    const existing = this.schemas.get(resource.id) ?? [];
    const schema: ResourceSchema = {
      id: `resource_schema_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      resourceId: resource.id,
      inputSchema: resource.inputSchema,
      outputSchema: resource.outputSchema,
      createdAt: new Date().toISOString()
    };

    this.schemas.set(resource.id, [...existing, schema]);
    return schema;
  }

  async createPaymentRequirement(resource: Resource) {
    const existing = this.paymentRequirements.get(resource.id) ?? [];
    const paymentRequirement: PaymentRequirement = {
      id: `payreq_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      resourceId: resource.id,
      scheme: "exact",
      network: resource.network,
      assetCode: resource.assetCode,
      assetIssuer: resource.assetIssuer,
      amount: resource.amount,
      payTo: resource.payTo,
      createdAt: new Date().toISOString()
    };

    this.paymentRequirements.set(resource.id, [...existing, paymentRequirement]);
    return paymentRequirement;
  }
}

export class ResourceService {
  constructor(
    private readonly config: AppConfig,
    private readonly sellerService: SellerService,
    private readonly store: ResourceStore = new InMemoryResourceStore()
  ) {}

  async createResource(input: unknown) {
    const resource = normalizeResourceInput(createResourceSchema.parse(input), this.config);
    await this.sellerService.getSeller(resource.sellerId);
    return this.store.createResource(resource);
  }

  async listResources(input: unknown) {
    const filters = listResourcesSchema.parse(input);
    return this.store.listResources(filters);
  }

  async getResource(resourceId: string) {
    const resource = await this.store.getResource(resourceId);

    if (resource === undefined) {
      throw new LumenError("RESOURCE_NOT_FOUND", "Resource was not found.");
    }

    return resource;
  }

  async updateResource(resourceId: string, input: unknown) {
    const existing = await this.getResource(resourceId);
    const patch = updateResourceSchema.parse(input);
    const normalized = normalizeResourceInput(mergeResourcePatch(existing, patch), this.config);

    return this.store.updateResource(resourceId, normalized);
  }

  async deleteResource(resourceId: string) {
    await this.getResource(resourceId);
    return this.store.updateResource(resourceId, { status: "inactive" });
  }

  getStore() {
    return this.store;
  }
}

function normalizeResourceInput<T extends CreateResourceInput | (Resource & UpdateResourceInput)>(
  input: T,
  config: AppConfig
): T {
  assertStellarPublicKey(input.payTo, "payTo");
  validateRouteTemplate(input.routeTemplate, input.inputSchema as JsonObject);
  const amount = normalizeExactAmount(input.amount);
  const assetCode = input.assetCode.toUpperCase();
  requireSupportedAsset(config, input.network, assetCode, input.assetIssuer);

  return {
    ...input,
    amount,
    assetCode
  };
}

function resourceMatchesFilters(resource: Resource, filters: ListResourceFilters) {
  return (
    (filters.sellerId === undefined || resource.sellerId === filters.sellerId) &&
    (filters.status === undefined || resource.status === filters.status) &&
    (filters.network === undefined || resource.network === filters.network) &&
    (filters.asset === undefined || resource.assetCode === filters.asset.toUpperCase()) &&
    (filters.type === undefined || resource.type === filters.type) &&
    (filters.minPrice === undefined ||
      compareExactAmounts(resource.amount, filters.minPrice) >= 0) &&
    (filters.maxPrice === undefined ||
      compareExactAmounts(resource.amount, filters.maxPrice) <= 0) &&
    (filters.extension === undefined ||
      Boolean(resource.extensions[filters.extension as keyof typeof resource.extensions]))
  );
}

function mergeResourcePatch(existing: Resource, patch: UpdateResourceInput): Resource {
  return {
    ...existing,
    type: patch.type ?? existing.type,
    name: patch.name ?? existing.name,
    description: patch.description ?? existing.description,
    url: patch.url ?? existing.url,
    routeTemplate: patch.routeTemplate ?? existing.routeTemplate,
    network: patch.network ?? existing.network,
    payTo: patch.payTo ?? existing.payTo,
    assetCode: patch.assetCode ?? existing.assetCode,
    assetIssuer: patch.assetIssuer ?? existing.assetIssuer,
    amount: patch.amount ?? existing.amount,
    inputSchema: (patch.inputSchema ?? existing.inputSchema) as JsonObject,
    outputSchema: (patch.outputSchema ?? existing.outputSchema) as JsonObject,
    extensions: (patch.extensions ?? existing.extensions) as JsonObject,
    status: patch.status ?? existing.status
  };
}

export function resourceToMetadata(resource: Resource): JsonObject {
  return {
    type: resource.type,
    name: resource.name,
    description: resource.description,
    url: resource.url,
    routeTemplate: resource.routeTemplate,
    network: resource.network,
    payTo: resource.payTo,
    assetCode: resource.assetCode,
    assetIssuer: resource.assetIssuer,
    amount: resource.amount,
    inputSchema: resource.inputSchema,
    outputSchema: resource.outputSchema,
    extensions: resource.extensions,
    status: resource.status
  };
}
