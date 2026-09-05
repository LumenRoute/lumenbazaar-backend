import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { parseBody, parseParams } from "../http/validation.js";
import { type ConformanceRunService } from "../services/conformance.js";

export type ConformanceRouteOptions = {
  conformanceService: ConformanceRunService;
};

export function registerConformanceRoutes(app: FastifyInstance, options: ConformanceRouteOptions) {
  const service = options.conformanceService;

  app.post("/v1/conformance/runs", async (request) => service.run(parseBody(request, z.unknown())));

  app.get("/v1/conformance/runs", async (request) => service.list(request.query));

  app.get("/v1/conformance/runs/:runId", async (request) => {
    const params = parseParams(request, z.object({ runId: z.string().min(1) }));
    return service.get(params.runId);
  });
}
