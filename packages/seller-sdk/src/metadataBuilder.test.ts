import { describe, expect, it } from "vitest";

import { httpResource, mcpResource, parseMetadata } from "./metadataBuilder.js";

const objectSchema = {
  type: "object",
  properties: {}
};

describe("seller SDK metadata builder", () => {
  it("builds and parses backend-compatible HTTP metadata", () => {
    const metadata = httpResource({
      name: "Paid Weather API",
      description: "Returns weather data.",
      url: "https://seller.example/weather",
      routeTemplate: "/weather/{city}",
      inputSchema: objectSchema,
      outputSchema: objectSchema
    });

    expect(parseMetadata(metadata)).toMatchObject({
      metadataVersion: 1,
      resource: {
        type: "http",
        routeTemplate: "/weather/{city}"
      }
    });
  });

  it("requires MCP metadata to include a stable MCP route template", () => {
    const metadata = mcpResource({
      name: "Search Docs",
      description: "Searches Stellar docs.",
      url: "https://seller.example/mcp",
      routeTemplate: "mcp://docs/search",
      inputSchema: objectSchema,
      outputSchema: objectSchema
    });

    expect(parseMetadata(metadata)).toMatchObject({
      resource: {
        type: "mcp",
        routeTemplate: "mcp://docs/search"
      }
    });

    expect(() =>
      parseMetadata({
        ...metadata,
        resource: {
          ...metadata.resource,
          routeTemplate: "/not-mcp"
        }
      })
    ).toThrow("MCP route template");
  });
});
