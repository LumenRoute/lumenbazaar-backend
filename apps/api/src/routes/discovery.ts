import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { parseBody } from "../http/validation.js";
import { type CatalogValidationService } from "../services/catalogValidation.js";

export type DiscoveryRouteOptions = {
  catalogValidationService: CatalogValidationService;
};

export function registerDiscoveryRoutes(app: FastifyInstance, options: DiscoveryRouteOptions) {
  app.post("/v1/discovery/validate", async (request) =>
    options.catalogValidationService.validate(parseBody(request, z.unknown()))
  );
}
