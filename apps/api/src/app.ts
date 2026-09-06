import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { loadConfig } from "@lumenbazaar/shared";
import {
  PaymentVerificationService,
  SettlementService,
  type ReceiptService
} from "@lumenbazaar/stellar-payments";

import { registerErrorHandling } from "./http/errors.js";
import { registerRateLimitHook } from "./http/rateLimit.js";
import { registerConformanceRoutes } from "./routes/conformance.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerFacilitatorRoutes } from "./routes/facilitator.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerSellerRoutes } from "./routes/sellers.js";
import { AuditLogService } from "./services/audit.js";
import { CatalogService } from "./services/cataloging.js";
import { CatalogValidationService } from "./services/catalogValidation.js";
import { ConformanceRunService, createServiceConformanceRunner } from "./services/conformance.js";
import { DiscoveryService } from "./services/discovery.js";
import { createMetricsService, type MetricsService } from "./services/metrics.js";
import { RateLimitService } from "./services/rateLimit.js";
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
  auditLogService?: AuditLogService;
  rateLimitService?: RateLimitService;
  metricsService?: MetricsService;
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

  const auditLogService = options.auditLogService ?? new AuditLogService();
  const rateLimitService = options.rateLimitService ?? new RateLimitService();
  const metricsService = options.metricsService ?? createMetricsService();

  registerRateLimitHook(app, { rateLimitService });
  registerMetadataRoutes(app, {
    config,
    metrics: metricsService
  });
  const verificationService =
    options.verificationService ?? new PaymentVerificationService(config, { auditLogService });
  const settlementService =
    options.settlementService ??
    new SettlementService(config, {
      auditLogService,
      attemptStore: verificationService.getAttemptStore()
    });
  const receiptService = options.receiptService ?? settlementService.getReceiptService();
  const sellerService = options.sellerService ?? new SellerService(undefined, auditLogService);
  const resourceService = options.resourceService ?? new ResourceService(config, sellerService);
  const catalogValidationService =
    options.catalogValidationService ?? new CatalogValidationService(config, sellerService);
  const catalogService =
    options.catalogService ??
    new CatalogService(catalogValidationService, resourceService, { auditLogService });
  const discoveryService = options.discoveryService ?? new DiscoveryService(resourceService);
  const searchService = options.searchService ?? new SearchService(resourceService, metricsService);
  const conformanceService =
    options.conformanceService ??
    new ConformanceRunService(
      createServiceConformanceRunner(config, verificationService, settlementService)
    );

  registerFacilitatorRoutes(app, {
    config,
    verificationService,
    settlementService,
    receiptService,
    metrics: metricsService
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
