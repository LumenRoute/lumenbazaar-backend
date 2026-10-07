import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { LumenError, type AppConfig, listConfiguredNetworks } from "@lumenbazaar/shared";
import {
  PaymentVerificationService,
  SettlementService,
  toLumenSettleResponse,
  toLumenVerifyResponse,
  type ReceiptService
} from "@lumenbazaar/stellar-payments";

import { parseParams } from "../http/validation.js";
import { type MetricsService } from "../services/metrics.js";
import { type ReadinessService } from "../services/readiness.js";

export type FacilitatorRouteOptions = {
  config: AppConfig;
  readiness: ReadinessService;
  verificationService?: PaymentVerificationService;
  settlementService?: SettlementService;
  receiptService?: ReceiptService;
  metrics?: MetricsService;
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

  app.get("/v1/supported", async () => {
    const capabilities = (await options.readiness.evaluate()).capabilities;
    const networks = listConfiguredNetworks(options.config);
    const exactKinds = capabilities.exact
      ? networks.map((network) => ({
          x402Version: 2,
          scheme: "exact",
          network: network.id,
          extra: {
            areFeesSponsored: true,
            assets: network.assets.map((asset) => ({
              code: asset.code,
              issuer: asset.issuer,
              contractId: asset.contractId,
              decimals: asset.decimals
            }))
          }
        }))
      : [];
    const uptoKinds = networks.flatMap((network) =>
      capabilities.upto &&
      options.config.features.uptoScheme &&
      network.uptoSessionContractId !== undefined
        ? [
            {
              x402Version: 2,
              scheme: "upto",
              network: network.id,
              extra: {
                assets: network.assets
                  .filter((asset) => asset.contractId !== undefined)
                  .map((asset) => ({
                    code: asset.code,
                    issuer: asset.issuer,
                    contractId: asset.contractId,
                    decimals: asset.decimals
                  })),
                contractId: network.uptoSessionContractId,
                sessionEndpoint: "/v1/payment-sessions"
              }
            }
          ]
        : []
    );

    const kinds = [...exactKinds, ...uptoKinds];

    return {
      kinds,
      extensions: ["bazaar"],
      signers: kinds.length === 0 ? {} : { "stellar:*": [options.config.facilitatorAccount] }
    };
  });

  app.post("/v1/verify", async (request) => {
    const startedAt = Date.now();
    const network = extractPaymentNetwork(request.body);

    try {
      return toLumenVerifyResponse(await verificationService.verify(request.body));
    } catch (error) {
      recordRpcErrorIfNeeded(options.metrics, network, "verify", error);
      throw error;
    } finally {
      options.metrics?.observeVerifyLatency(network, Date.now() - startedAt);
    }
  });

  app.post("/v1/settle", async (request) => {
    const startedAt = Date.now();
    const network = extractPaymentNetwork(request.body);

    try {
      const result = await settlementService.settle(request.body);
      options.metrics?.recordSettlementResult(result.network, "settled");
      return toLumenSettleResponse(result);
    } catch (error) {
      options.metrics?.recordSettlementResult(network, "failed");
      recordRpcErrorIfNeeded(options.metrics, network, "settle", error);
      throw error;
    } finally {
      options.metrics?.observeSettleLatency(network, Date.now() - startedAt);
    }
  });
  app.get("/v1/receipts/:receiptId", async (request) => {
    const params = parseParams(request, z.object({ receiptId: z.string().min(1) }));
    return receiptService.getReceipt(params.receiptId);
  });
}

function extractPaymentNetwork(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "unknown";
  }

  const paymentPayload = (body as Record<string, unknown>).paymentPayload;

  if (
    typeof paymentPayload === "object" &&
    paymentPayload !== null &&
    !Array.isArray(paymentPayload)
  ) {
    const accepted = (paymentPayload as Record<string, unknown>).accepted;
    const network =
      typeof accepted === "object" && accepted !== null && !Array.isArray(accepted)
        ? (accepted as Record<string, unknown>).network
        : undefined;

    if (typeof network === "string") {
      return network;
    }
  }

  return "unknown";
}

function recordRpcErrorIfNeeded(
  metrics: MetricsService | undefined,
  network: string,
  operation: string,
  error: unknown
) {
  if (metrics === undefined) {
    return;
  }

  if (error instanceof LumenError) {
    if (error.code === "SETTLEMENT_FAILED" || error.code === "TRUSTLINE_REQUIRED") {
      metrics.recordRpcError(network, operation);
    }
    return;
  }

  metrics.recordRpcError(network, operation);
}
