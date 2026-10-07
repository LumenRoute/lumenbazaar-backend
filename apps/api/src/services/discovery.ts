import { z } from "zod";

import { type Resource } from "@lumenbazaar/shared";

import { type ResourceService } from "./resources.js";

export const browseDiscoverySchema = z.object({
  network: z.enum(["stellar:testnet", "stellar:pubnet"]).optional(),
  asset: z.string().optional(),
  type: z.enum(["http", "mcp"]).optional(),
  sellerId: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
  extension: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional()
});

export type DiscoveryBrowseResult = {
  resources: Resource[];
  nextCursor: string | null;
  partialResults: false;
};

export class DiscoveryService {
  constructor(private readonly resourceService: ResourceService) {}

  async browse(input: unknown): Promise<DiscoveryBrowseResult> {
    const page = await this.resourceService.listResources({
      ...browseDiscoverySchema.parse(input),
      status: "active"
    });

    return {
      resources: page.resources,
      nextCursor: page.nextCursor,
      partialResults: false
    };
  }
}
