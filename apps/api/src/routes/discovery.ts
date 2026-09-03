import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { parseBody } from "../http/validation.js";
import { type CatalogService } from "../services/cataloging.js";
import { type CatalogValidationService } from "../services/catalogValidation.js";

export type DiscoveryRouteOptions = {
  catalogValidationService: CatalogValidationService;
  catalogService: CatalogService;
};

export function registerDiscoveryRoutes(app: FastifyInstance, options: DiscoveryRouteOptions) {
  app.post("/v1/discovery/validate", async (request) =>
    options.catalogValidationService.validate(parseBody(request, z.unknown()))
  );

  app.post("/v1/discovery/catalog", async (request) =>
    options.catalogService.catalog(parseBody(request, z.unknown()))
  );
}
