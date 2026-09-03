import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { loadConfig } from "@lumenbazaar/shared";
import {
  type PaymentVerificationService,
  type ReceiptService,
  type SettlementService
} from "@lumenbazaar/stellar-payments";

import { registerErrorHandling } from "./http/errors.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerFacilitatorRoutes } from "./routes/facilitator.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerSellerRoutes } from "./routes/sellers.js";
import { CatalogService } from "./services/cataloging.js";
import { CatalogValidationService } from "./services/catalogValidation.js";
import { DiscoveryService } from "./services/discovery.js";
import { createMetricsService } from "./services/metrics.js";
import { ResourceService } from "./services/resources.js";
import { SellerService } from "./services/sellers.js";

export type BuildApiAppOptions = {
  logger?: boolean;
  verificationService?: PaymentVerificationService;
  settlementService?: SettlementService;
  receiptService?: ReceiptService;
  sellerService?: SellerService;
  resourceService?: ResourceService;
  catalogValidationService?: CatalogValidationService;
  catalogService?: CatalogService;
  discoveryService?: DiscoveryService;
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
    compactFacilitatorOptions({
      config,
      verificationService: options.verificationService,
      settlementService: options.settlementService,
      receiptService: options.receiptService
    })
  );
  const sellerService = options.sellerService ?? new SellerService();
  const resourceService = options.resourceService ?? new ResourceService(config, sellerService);
  const catalogValidationService =
    options.catalogValidationService ?? new CatalogValidationService(config, sellerService);
  const catalogService =
    options.catalogService ?? new CatalogService(catalogValidationService, resourceService);
  const discoveryService = options.discoveryService ?? new DiscoveryService(resourceService);

  registerSellerRoutes(app, { sellerService });
  registerResourceRoutes(app, { resourceService });
  registerDiscoveryRoutes(app, { catalogValidationService, catalogService, discoveryService });

  return app;
}

function compactFacilitatorOptions(options: {
  config: ReturnType<typeof loadConfig>;
  verificationService?: PaymentVerificationService | undefined;
  settlementService?: SettlementService | undefined;
  receiptService?: ReceiptService | undefined;
}) {
  return {
    config: options.config,
    ...(options.verificationService === undefined
      ? {}
      : { verificationService: options.verificationService }),
    ...(options.settlementService === undefined
      ? {}
      : { settlementService: options.settlementService }),
    ...(options.receiptService === undefined ? {} : { receiptService: options.receiptService })
  };
}
