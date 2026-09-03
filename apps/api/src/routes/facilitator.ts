import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { type AppConfig, listConfiguredNetworks } from "@lumenbazaar/shared";
import {
  PaymentVerificationService,
  SettlementService,
  type ReceiptService
} from "@lumenbazaar/stellar-payments";

import { parseParams } from "../http/validation.js";

export type FacilitatorRouteOptions = {
  config: AppConfig;
  verificationService?: PaymentVerificationService;
  settlementService?: SettlementService;
  receiptService?: ReceiptService;
};

export function registerFacilitatorRoutes(app: FastifyInstance, options: FacilitatorRouteOptions) {
  const verificationService =
    options.verificationService ?? new PaymentVerificationService(options.config);
  const settlementService =
    options.settlementService ??
    new SettlementService(options.config, {
      attemptStore: verificationService.getAttemptStore()
    });
  const receiptService = options.receiptService ?? settlementService.getReceiptService();

  app.get("/v1/supported", async () => ({
    schemes: listConfiguredNetworks(options.config).map((network) => ({
      name: "exact",
      network: network.id,
      assets: network.assets.map((asset) => ({
        code: asset.code,
        issuer: asset.issuer,
        decimals: asset.decimals
      })),
      extensions: {
        x402Version: "1",
        upto: false
      }
    })),
    extensions: {
      bazaar: true,
      upto: options.config.features.uptoScheme,
      uptoContracts: []
    }
  }));

  app.post("/v1/verify", async (request) => verificationService.verify(request.body));
  app.post("/v1/settle", async (request) => settlementService.settle(request.body));
  app.get("/v1/receipts/:receiptId", async (request) => {
    const params = parseParams(request, z.object({ receiptId: z.string().min(1) }));
    return receiptService.getReceipt(params.receiptId);
  });
}
