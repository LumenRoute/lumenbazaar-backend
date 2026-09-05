import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { loadConfig } from "@lumenbazaar/shared";
import {
  PaymentVerificationService,
  SettlementService,
  type ReceiptService
} from "@lumenbazaar/stellar-payments";

import { registerErrorHandling } from "./http/errors.js";
import { registerConformanceRoutes } from "./routes/conformance.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerFacilitatorRoutes } from "./routes/facilitator.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerSellerRoutes } from "./routes/sellers.js";
import { CatalogService } from "./services/cataloging.js";
import { CatalogValidationService } from "./services/catalogValidation.js";
import { ConformanceRunService, createServiceConformanceRunner } from "./services/conformance.js";
import { DiscoveryService } from "./services/discovery.js";
import { createMetricsService } from "./services/metrics.js";
import { ResourceService } from "./services/resources.js";
import { SearchService } from "./services/search.js";
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
  searchService?: SearchService;
  conformanceService?: ConformanceRunService;
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
  const verificationService = options.verificationService ?? new PaymentVerificationService(config);
  const settlementService =
    options.settlementService ??
    new SettlementService(config, {
      attemptStore: verificationService.getAttemptStore()
    });
  const receiptService = options.receiptService ?? settlementService.getReceiptService();
  const sellerService = options.sellerService ?? new SellerService();
  const resourceService = options.resourceService ?? new ResourceService(config, sellerService);
  const catalogValidationService =
    options.catalogValidationService ?? new CatalogValidationService(config, sellerService);
  const catalogService =
    options.catalogService ?? new CatalogService(catalogValidationService, resourceService);
  const discoveryService = options.discoveryService ?? new DiscoveryService(resourceService);
  const searchService = options.searchService ?? new SearchService(resourceService);
  const conformanceService =
    options.conformanceService ??
    new ConformanceRunService(
      createServiceConformanceRunner(config, verificationService, settlementService)
    );

  registerFacilitatorRoutes(app, {
    config,
    verificationService,
    settlementService,
    receiptService
  });
  registerSellerRoutes(app, { sellerService });
  registerResourceRoutes(app, { resourceService });
  registerDiscoveryRoutes(app, {
    catalogValidationService,
    catalogService,
    discoveryService,
    searchService
  });
  registerConformanceRoutes(app, {
    conformanceService
  });

  return app;
}
