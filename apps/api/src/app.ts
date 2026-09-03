import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { loadConfig } from "@lumenbazaar/shared";
import {
  type PaymentVerificationService,
  type SettlementService
} from "@lumenbazaar/stellar-payments";

import { registerErrorHandling } from "./http/errors.js";
import { registerFacilitatorRoutes } from "./routes/facilitator.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { createMetricsService } from "./services/metrics.js";

export type BuildApiAppOptions = {
  logger?: boolean;
  verificationService?: PaymentVerificationService;
  settlementService?: SettlementService;
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
      ? options.settlementService === undefined
        ? { config }
        : { config, settlementService: options.settlementService }
      : options.settlementService === undefined
        ? { config, verificationService: options.verificationService }
        : {
            config,
            verificationService: options.verificationService,
            settlementService: options.settlementService
          }
  );

  return app;
}
