import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { loadConfig } from "@lumenbazaar/shared";
import {
  type PaymentVerificationService,
  type ReceiptService,
  type SettlementService
} from "@lumenbazaar/stellar-payments";

import { registerErrorHandling } from "./http/errors.js";
import { registerFacilitatorRoutes } from "./routes/facilitator.js";
import { registerMetadataRoutes } from "./routes/metadata.js";
import { registerSellerRoutes } from "./routes/sellers.js";
import { createMetricsService } from "./services/metrics.js";
import { type SellerService } from "./services/sellers.js";

export type BuildApiAppOptions = {
  logger?: boolean;
  verificationService?: PaymentVerificationService;
  settlementService?: SettlementService;
  receiptService?: ReceiptService;
  sellerService?: SellerService;
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
  registerSellerRoutes(app, compactSellerOptions({ sellerService: options.sellerService }));

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

function compactSellerOptions(options: { sellerService?: SellerService | undefined }) {
  return {
    ...(options.sellerService === undefined ? {} : { sellerService: options.sellerService })
  };
}
