import { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

import { type SellerApiKeyPrincipal } from "@lumenbazaar/shared";

import { applyPrivateNoStore, sendConditionalGet } from "../http/conditional.js";
import { parseBody, parseIfMatchHeader, parseParams, parseQuery } from "../http/validation.js";
import { type ResourceService } from "../services/resources.js";

export type ResourceRouteOptions = {
  resourceService: ResourceService;
};

export function registerResourceRoutes(app: FastifyInstance, options: ResourceRouteOptions) {
  app.get("/v1/resources", async (request, reply) =>
    sendConditionalGet(request, reply, await options.resourceService.listResources(request.query))
  );

  app.post("/v1/resources", async (request) =>
    options.resourceService.createResource(
      parseBody(request, z.unknown()),
      getSellerContext(request)
    )
  );

  app.get("/v1/resources/:id", async (request, reply) => {
    const params = parseParams(request, z.object({ id: z.string().min(1) }));
    return sendConditionalGet(request, reply, await options.resourceService.getResource(params.id));
  });

  app.patch("/v1/resources/:id", async (request) => {
    const params = parseParams(request, z.object({ id: z.string().min(1) }));
    return options.resourceService.updateResource(
      params.id,
      parseBody(request, z.unknown()),
      getSellerContext(request),
      { expectedVersion: parseIfMatchHeader(request) }
    );
  });

  app.delete("/v1/resources/:id", async (request) => {
    const params = parseParams(request, z.object({ id: z.string().min(1) }));
    return options.resourceService.deleteResource(params.id, getSellerContext(request), {
      expectedVersion: parseIfMatchHeader(request)
    });
  });

  // Authorization-specific: version history is owner-scoped when a seller
  // API key is presented, so it is never given a shared/public validator.
  app.get("/v1/resources/:id/versions", async (request, reply) => {
    const params = parseParams(request, z.object({ id: z.string().min(1) }));
    applyPrivateNoStore(reply);
    return options.resourceService.listResourceVersions(params.id);
  });

  app.get("/v1/resources/:id/versions/:version", async (request, reply) => {
    const params = parseParams(
      request,
      z.object({ id: z.string().min(1), version: z.coerce.number().int().positive() })
    );
    applyPrivateNoStore(reply);
    return options.resourceService.getResourceVersion(params.id, params.version);
  });

  app.post("/v1/resources/:id/rollback", async (request) => {
    const params = parseParams(
      request,
      z.object({ id: z.string().min(1), version: z.coerce.number().int().positive() })
    );
    return options.resourceService.rollbackResource(
      params.id,
      params.version,
      getSellerContext(request),
      { expectedVersion: parseIfMatchHeader(request) }
    );
  });

  app.post("/v1/resources/:id/restore", async (request) => {
    const params = parseParams(request, z.object({ id: z.string().min(1) }));
    return options.resourceService.restoreResource(
      params.id,
      getSellerContext(request),
      { expectedVersion: parseIfMatchHeader(request) }
    );
  });

  // Authorization-specific: seller-scoped list, never a shared/public validator.
  app.get("/v1/sellers/:sellerId/resources", async (request, reply) => {
    const params = parseParams(request, z.object({ sellerId: z.string().min(1) }));
    const query = parseQuery(request, z.record(z.string(), z.unknown()));
    applyPrivateNoStore(reply);
    return options.resourceService.listResources({ ...query, sellerId: params.sellerId });
  });
}

function getSellerContext(
  request: FastifyRequest
): { sellerId: string; auditable: boolean } | undefined {
  const principal = request.sellerApiKeyPrincipal as SellerApiKeyPrincipal | undefined;
  if (principal === undefined) {
    return undefined;
  }
  return {
    sellerId: principal.sellerId,
    auditable: true
  };
}
