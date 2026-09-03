import { type FastifyInstance } from "fastify";

import { type AppConfig, listConfiguredNetworks } from "@lumenbazaar/shared";
import { PaymentVerificationService, SettlementService } from "@lumenbazaar/stellar-payments";

export type FacilitatorRouteOptions = {
  config: AppConfig;
  verificationService?: PaymentVerificationService;
  settlementService?: SettlementService;
};

export function registerFacilitatorRoutes(app: FastifyInstance, options: FacilitatorRouteOptions) {
  const verificationService =
    options.verificationService ?? new PaymentVerificationService(options.config);
  const settlementService =
    options.settlementService ??
    new SettlementService(options.config, {
      attemptStore: verificationService.getAttemptStore()
    });

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
}
