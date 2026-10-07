import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import Fastify from "fastify";

import { type AppConfig, listConfiguredNetworks, loadConfig } from "@lumenbazaar/shared";
import {
  PaymentSessionService,
  PaymentVerificationService,
  ReceiptService,
  SettlementService,
  createPaymentPersistence,
  createX402StellarAdapter,
  type FacilitatorSignerProvider
} from "@lumenbazaar/stellar-payments";

import { registerErrorHandling } from "./http/errors.js";
import { registerRateLimitHook } from "./http/rateLimit.js";
import { registerConformanceRoutes } from "./routes/conformance.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerFacilitatorRoutes } from "./routes/facilitator.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerPaymentSessionRoutes } from "./routes/paymentSessions.js";
import { registerResourceRoutes } from "./routes/resources.js";
import { registerSellerRoutes } from "./routes/sellers.js";
import { AuditLogService } from "./services/audit.js";
import { CatalogService } from "./services/cataloging.js";
import { CatalogValidationService } from "./services/catalogValidation.js";
import { ConformanceRunService, createServiceConformanceRunner } from "./services/conformance.js";
import { DiscoveryService } from "./services/discovery.js";
import { createMetricsService, type MetricsService } from "./services/metrics.js";
import { createRuntimeRateLimitService, type RateLimitService } from "./services/rateLimit.js";
import {
  createReadinessService,
  createRuntimeReadinessProbes,
  type PaymentCapabilities,
  type ReadinessService
} from "./services/readiness.js";
import { ResourceService } from "./services/resources.js";
import { SearchService } from "./services/search.js";
import { SellerService } from "./services/sellers.js";

export type BuildApiAppOptions = {
  config?: AppConfig;
  logger?: boolean;
  paymentSessionService?: PaymentSessionService;
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
  paymentCapabilities?: PaymentCapabilities;
  readinessService?: ReadinessService;
  signerProvider?: FacilitatorSignerProvider;
};

export function buildApiApp(options: BuildApiAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: options.logger ?? config.nodeEnv !== "test",
    trustProxy: false
  });
  const paymentPersistence = createPaymentPersistence(config);
  app.addHook("onClose", async () => paymentPersistence.close());
  const runtimeAdapter =
    options.signerProvider === undefined
      ? undefined
      : createX402StellarAdapter({ config, signerProvider: options.signerProvider });
  const paymentCapabilities = options.paymentCapabilities ?? {
    exact:
      runtimeAdapter !== undefined &&
      listConfiguredNetworks(config).every((network) =>
        network.assets.some((asset) => asset.contractId !== undefined)
      ),
    upto: false
  };
  const readinessService =
    options.readinessService ??
    createReadinessService(
      config,
      paymentCapabilities,
      createRuntimeReadinessProbes(config, options.signerProvider)
    );

  void app.register(cors, {
    origin: config.api.corsAllowedOrigins
  });

  registerErrorHandling(app);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  const auditLogService = options.auditLogService ?? new AuditLogService();
  const runtimeRateLimit =
    options.rateLimitService === undefined ? createRuntimeRateLimitService(config) : undefined;
  const rateLimitService = options.rateLimitService ?? runtimeRateLimit!.service;
  if (runtimeRateLimit !== undefined) {
    app.addHook("onClose", async () => runtimeRateLimit.close());
  }
  const metricsService = options.metricsService ?? createMetricsService();
  const receiptService =
    options.receiptService ?? new ReceiptService({ receiptStore: paymentPersistence.receiptStore });

  registerRateLimitHook(app, { rateLimitService });
  registerMetadataRoutes(app, {
    config,
    metrics: metricsService,
    readiness: readinessService
  });
  const verificationService =
    options.verificationService ??
    new PaymentVerificationService(config, {
      auditLogService,
      attemptStore: paymentPersistence.attemptStore,
      ...(runtimeAdapter === undefined ? {} : { adapter: runtimeAdapter })
    });
  const settlementService =
    options.settlementService ??
    new SettlementService(config, {
      auditLogService,
      attemptStore: verificationService.getAttemptStore(),
      settlementStore: paymentPersistence.settlementStore,
      receiptService,
      ...(options.verificationService === undefined &&
      paymentPersistence.statePersistence !== undefined
        ? { statePersistence: paymentPersistence.statePersistence }
        : {}),
      ...(runtimeAdapter === undefined ? {} : { adapter: runtimeAdapter })
    });
  const routeReceiptService = options.receiptService ?? settlementService.getReceiptService();
  const paymentSessionService =
    options.paymentSessionService ?? new PaymentSessionService(config, { auditLogService });
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
      createServiceConformanceRunner(
        config,
        verificationService,
        settlementService,
        paymentSessionService
      ),
      undefined,
      {
        exactEnabled: paymentCapabilities.exact,
        uptoEnabled: config.features.uptoScheme && paymentCapabilities.upto
      }
    );

  registerFacilitatorRoutes(app, {
    config,
    verificationService,
    settlementService,
    receiptService: routeReceiptService,
    metrics: metricsService,
    readiness: readinessService
  });
  registerPaymentSessionRoutes(app, { paymentSessionService });
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
