import { type JsonObject } from "@lumenbazaar/shared";

export type ResourceMetadata = {
  metadataVersion: 1;
  resource: {
    type: "http" | "mcp";
    name: string;
    description: string;
    url: string;
    routeTemplate: string;
    inputSchema: JsonObject;
    outputSchema: JsonObject;
    extensions?: JsonObject;
  };
};

export type HttpResourceMetadata = ResourceMetadata & {
  resource: ResourceMetadata["resource"] & {
    type: "http";
    routeTemplate: string;
  };
};

export type McpResourceMetadata = ResourceMetadata & {
  resource: ResourceMetadata["resource"] & {
    type: "mcp";
    routeTemplate: string;
  };
};

/**
 * Builder for Bazaar Resource Metadata
 * Fluent API for constructing discoverable resource metadata
 */
export class MetadataBuilder {
  private metadata: Partial<ResourceMetadata> = {
    metadataVersion: 1
  };

  private resource: Partial<ResourceMetadata["resource"]> = {
    inputSchema: {},
    outputSchema: {},
    extensions: {}
  };

  /**
   * Set resource type (http or mcp)
   */
  type(type: "http" | "mcp"): this {
    this.resource.type = type;
    return this;
  }

  /**
   * Set resource name
   */
  name(name: string): this {
    this.resource.name = name;
    return this;
  }

  /**
   * Set resource description
   */
  description(description: string): this {
    this.resource.description = description;
    return this;
  }

  /**
   * Set resource base URL
   */
  url(url: string): this {
    this.resource.url = url;
    return this;
  }

  /**
   * Set route template for HTTP resources
   * Example: "/api/resource/{id}"
   */
  routeTemplate(template: string): this {
    this.resource.routeTemplate = template;
    return this;
  }

  /**
   * Set input schema (JSON Schema)
   */
  inputSchema(schema: JsonObject): this {
    this.resource.inputSchema = schema;
    return this;
  }

  /**
   * Set output schema (JSON Schema)
   */
  outputSchema(schema: JsonObject): this {
    this.resource.outputSchema = schema;
    return this;
  }

  /**
   * Set custom extensions
   */
  extensions(extensions: JsonObject): this {
    this.resource.extensions = extensions;
    return this;
  }

  /**
   * Mark resource as trusted (seller is domain verified)
   */
  trusted(isTrusted: boolean): this {
    if (!this.resource.extensions) {
      this.resource.extensions = {};
    }
    (this.resource.extensions as Record<string, unknown>).trusted = isTrusted;
    return this;
  }

  /**
   * Build and validate the metadata
   */
  build(): ResourceMetadata {
    const resource = this.resource;

    if (!resource.type) {
      throw new Error("Resource type is required");
    }
    if (!resource.name) {
      throw new Error("Resource name is required");
    }
    if (!resource.description) {
      throw new Error("Resource description is required");
    }
    if (!resource.url) {
      throw new Error("Resource URL is required");
    }

    if (!resource.routeTemplate) {
      throw new Error("Route template is required");
    }

    return {
      metadataVersion: 1,
      resource: {
        type: resource.type,
        name: resource.name,
        description: resource.description,
        url: resource.url,
        routeTemplate: resource.routeTemplate,
        inputSchema: resource.inputSchema || {},
        outputSchema: resource.outputSchema || {},
        extensions: resource.extensions || {}
      }
    } as ResourceMetadata;
  }
}

/**
 * Create a new metadata builder
 */
export function createMetadata(): MetadataBuilder {
  return new MetadataBuilder();
}

/**
 * Create HTTP resource metadata
 */
export function httpResource(params: {
  name: string;
  description: string;
  url: string;
  routeTemplate: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  trusted?: boolean;
}): HttpResourceMetadata {
  const builder = createMetadata()
    .type("http")
    .name(params.name)
    .description(params.description)
    .url(params.url)
    .routeTemplate(params.routeTemplate)
    .inputSchema(params.inputSchema)
    .outputSchema(params.outputSchema);

  if (params.trusted) {
    builder.trusted(true);
  }

  return builder.build() as HttpResourceMetadata;
}

/**
 * Create MCP tool resource metadata
 */
export function mcpResource(params: {
  name: string;
  description: string;
  url: string;
  routeTemplate: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  trusted?: boolean;
}): McpResourceMetadata {
  const builder = createMetadata()
    .type("mcp")
    .name(params.name)
    .description(params.description)
    .url(params.url)
    .routeTemplate(params.routeTemplate)
    .inputSchema(params.inputSchema)
    .outputSchema(params.outputSchema);

  if (params.trusted) {
    builder.trusted(true);
  }

  return builder.build() as McpResourceMetadata;
}

/**
 * Parse and validate Bazaar resource metadata received from a file or API payload.
 */
export function parseMetadata(input: unknown): ResourceMetadata {
  const metadata = requireRecord(input, "Metadata");

  if (metadata.metadataVersion !== 1) {
    throw new Error("Metadata version must be 1");
  }

  const resource = requireRecord(metadata.resource, "Metadata resource");
  const type = requireResourceType(resource.type);
  const name = requireString(resource.name, "Resource name");
  const description = requireString(resource.description, "Resource description");
  const url = requireString(resource.url, "Resource URL");
  const routeTemplate = requireString(resource.routeTemplate, "Route template");
  const inputSchema = requireJsonObject(resource.inputSchema, "Input schema");
  const outputSchema = requireJsonObject(resource.outputSchema, "Output schema");
  const extensions =
    resource.extensions === undefined
      ? {}
      : requireJsonObject(resource.extensions, "Resource extensions");

  try {
    new URL(url);
  } catch {
    throw new Error("Resource URL must be a valid URL");
  }

  if (type === "http" && !routeTemplate.startsWith("/")) {
    throw new Error("HTTP route template must start with /");
  }

  if (type === "mcp" && !/^mcp:\/\/[a-zA-Z0-9\-_.]+\/[a-zA-Z0-9\-_]+$/.test(routeTemplate)) {
    throw new Error("MCP route template must use mcp://server/tool format");
  }

  return {
    metadataVersion: 1,
    resource: {
      type,
      name,
      description,
      url,
      routeTemplate,
      inputSchema,
      outputSchema,
      extensions
    }
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }

  return value.trim();
}

function requireResourceType(value: unknown): "http" | "mcp" {
  if (value === "http" || value === "mcp") {
    return value;
  }

  throw new Error("Resource type must be http or mcp");
}

function requireJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return value as JsonObject;
}
