import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { parseBody } from "../http/validation.js";
import { type CatalogService } from "../services/cataloging.js";
import { type CatalogValidationService } from "../services/catalogValidation.js";
import { type DiscoveryService } from "../services/discovery.js";
import { type SearchService } from "../services/search.js";

export type DiscoveryRouteOptions = {
  catalogValidationService: CatalogValidationService;
  catalogService: CatalogService;
  discoveryService: DiscoveryService;
  searchService: SearchService;
};

export function registerDiscoveryRoutes(app: FastifyInstance, options: DiscoveryRouteOptions) {
  app.get("/v1/discovery/resources", async (request) =>
    options.discoveryService.browse(request.query)
  );

  app.get("/v1/discovery/search", async (request) => options.searchService.search(request.query));

  app.post("/v1/discovery/validate", async (request) =>
    options.catalogValidationService.validate(parseBody(request, z.unknown()))
  );

  app.post("/v1/discovery/catalog", async (request) =>
    options.catalogService.catalog(parseBody(request, z.unknown()))
  );
}
