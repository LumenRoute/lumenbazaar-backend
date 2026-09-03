import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { parseBody, parseParams } from "../http/validation.js";
import { SellerService } from "../services/sellers.js";

export type SellerRouteOptions = {
  sellerService?: SellerService;
};

export function registerSellerRoutes(app: FastifyInstance, options: SellerRouteOptions = {}) {
  const sellerService = options.sellerService ?? new SellerService();

  app.post("/v1/sellers", async (request) =>
    sellerService.createSeller(parseBody(request, z.unknown()))
  );

  app.get("/v1/sellers/:sellerId", async (request) => {
    const params = parseParams(request, z.object({ sellerId: z.string().min(1) }));
    return sellerService.getSeller(params.sellerId);
  });
}
