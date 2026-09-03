import { describe, expect, it } from "vitest";

import { localIssuerPublicKey } from "@lumenbazaar/shared";

import {
  metadataResourceKind,
  parseDiscoveryMetadata,
  toResourceCreateInput
} from "./discoveryMetadata.js";

function metadata(type: "http" | "mcp" = "http") {
  return {
    sellerId: "seller_1",
    resource: {
      type,
      name: "Paid Weather API",
      description: "Returns current weather for a city.",
      url: "https://seller.example/weather/Lagos",
      routeTemplate: "/weather/{city}",
      network: "stellar:testnet",
      payTo: localIssuerPublicKey,
      assetCode: "USDC",
      assetIssuer: localIssuerPublicKey,
      amount: "0.05",
      inputSchema: {
        type: "object"
      },
      outputSchema: {
        type: "object"
      },
      extensions:
        type === "mcp"
          ? {
              mcp: {
                toolName: "get_weather"
              }
            }
          : {
              bazaar: true
            }
    }
  };
}

describe("discovery metadata schema", () => {
  it("parses versioned HTTP metadata", () => {
    const parsed = parseDiscoveryMetadata(metadata("http"));

    expect(parsed.metadataVersion).toBe(1);
    expect(metadataResourceKind(parsed)).toBe("http");
    expect(toResourceCreateInput(parsed)).toMatchObject({
      sellerId: "seller_1",
      type: "http",
      routeTemplate: "/weather/{city}"
    });
  });

  it("parses versioned MCP tool metadata", () => {
    expect(parseDiscoveryMetadata(metadata("mcp"))).toMatchObject({
      metadataVersion: 1,
      resource: {
        type: "mcp",
        extensions: {
          mcp: {
            toolName: "get_weather"
          }
        }
      }
    });
  });

  it("rejects MCP metadata without tool identity", () => {
    expect(() =>
      parseDiscoveryMetadata({
        ...metadata("mcp"),
        resource: {
          ...metadata("mcp").resource,
          extensions: {}
        }
      })
    ).toThrow("MCP resources require");
  });
});
