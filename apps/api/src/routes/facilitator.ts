import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { LumenError, type AppConfig, listConfiguredNetworks } from "@lumenbazaar/shared";
import {
  PaymentVerificationService,
  SettlementService,
  type ReceiptService
} from "@lumenbazaar/stellar-payments";

import { parseParams } from "../http/validation.js";
import { type MetricsService } from "../services/metrics.js";

export type FacilitatorRouteOptions = {
  capabilities: {
    exact: boolean;
    upto: boolean;
  };
  config: AppConfig;
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
    const networks = listConfiguredNetworks(options.config);
    const uptoContracts = networks.flatMap((network) =>
      options.capabilities.upto &&
      options.config.features.uptoScheme &&
      network.uptoSessionContractId !== undefined
        ? [
            {
              network: network.id,
              contractId: network.uptoSessionContractId
            }
          ]
        : []
    );
    const exactSchemes = options.capabilities.exact
      ? networks.map((network) => ({
          name: "exact",
          network: network.id,
          assets: network.assets.map((asset) => ({
            code: asset.code,
            issuer: asset.issuer,
            decimals: asset.decimals
          })),
          extensions: {
            x402Version: "2",
            upto: false
          }
        }))
      : [];
    const uptoSchemes = networks.flatMap((network) =>
      options.capabilities.upto &&
      options.config.features.uptoScheme &&
      network.uptoSessionContractId !== undefined
        ? [
            {
              name: "upto",
              network: network.id,
              assets: network.assets
                .filter((asset) => asset.contractId !== undefined)
                .map((asset) => ({
                  code: asset.code,
                  issuer: asset.issuer,
                  contractId: asset.contractId,
                  decimals: asset.decimals
                })),
              extensions: {
                contractId: network.uptoSessionContractId,
                x402Version: "2",
                sessionEndpoint: "/v1/payment-sessions"
              }
            }
          ]
        : []
    );

    return {
      schemes: [...exactSchemes, ...uptoSchemes],
      extensions: {
        bazaar: true,
        upto: options.capabilities.upto && options.config.features.uptoScheme,
        uptoContracts
      }
    };
  });

  app.post("/v1/verify", async (request) => {
    const startedAt = Date.now();
    const network = extractPaymentNetwork(request.body);

    try {
      return await verificationService.verify(request.body);
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
      return result;
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
    const network = (paymentPayload as Record<string, unknown>).network;

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
