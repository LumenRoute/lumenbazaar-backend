import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { loadConfig } from "@lumenbazaar/shared";
import { type PaymentVerificationService } from "@lumenbazaar/stellar-payments";

import { registerErrorHandling } from "./http/errors.js";
import { registerFacilitatorRoutes } from "./routes/facilitator.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { createMetricsService } from "./services/metrics.js";

export type BuildApiAppOptions = {
  logger?: boolean;
  verificationService?: PaymentVerificationService;
};

export function buildApiApp(options: BuildApiAppOptions = {}) {
  const config = loadConfig();
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: options.logger ?? config.nodeEnv !== "test"
  });

  registerErrorHandling(app);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  registerMetadataRoutes(app, {
    config,
    metrics: createMetricsService()
  });
  registerFacilitatorRoutes(
    app,
    options.verificationService === undefined
      ? { config }
      : { config, verificationService: options.verificationService }
  );

  return app;
}
