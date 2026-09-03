import { type JsonObject } from "@lumenbazaar/shared";

export type ResourceMetadata = {
  metadataVersion: 1;
  resource: {
    type: "http" | "mcp";
    name: string;
    description: string;
    url: string;
    routeTemplate?: string;
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

    if (resource.type === "http" && !resource.routeTemplate) {
      throw new Error("Route template is required for HTTP resources");
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
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  trusted?: boolean;
}): McpResourceMetadata {
  const builder = createMetadata()
    .type("mcp")
    .name(params.name)
    .description(params.description)
    .url(params.url)
    .inputSchema(params.inputSchema)
    .outputSchema(params.outputSchema);

  if (params.trusted) {
    builder.trusted(true);
  }

  return builder.build() as McpResourceMetadata;
}
