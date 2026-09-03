import { z } from "zod";

import {
  LumenError,
  type AppConfig,
  type NetworkId,
  isSupportedNetwork,
  normalizeAssetCode
} from "@lumenbazaar/shared";

import { requireSupportedAsset } from "./clients.js";
import { amountsEqual, normalizeExactAmount } from "./amounts.js";
import { assertStellarPublicKey } from "./addresses.js";

const assetSchema = z.object({
  code: z.string().min(1).max(12),
  issuer: z.string().min(1)
});

export const exactPaymentPayloadSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string(),
  asset: assetSchema,
  amount: z.string(),
  payTo: z.string(),
  expiresAtLedger: z.number().int().positive().optional(),
  authorization: z.record(z.string(), z.unknown()).default({}),
  paymentHash: z.string().optional()
});

export const exactPaymentRequirementsSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string(),
  asset: assetSchema.optional(),
  amount: z.string(),
  payTo: z.string()
});

export const verifyPaymentRequestSchema = z.object({
  paymentPayload: exactPaymentPayloadSchema,
  paymentRequirements: exactPaymentRequirementsSchema,
  resourceId: z.string().optional(),
  sellerId: z.string().optional(),
  currentLedger: z.number().int().nonnegative().optional()
});

export type ExactPaymentPayload = z.output<typeof exactPaymentPayloadSchema>;
export type ExactPaymentRequirements = z.output<typeof exactPaymentRequirementsSchema>;
export type VerifyPaymentRequest = z.output<typeof verifyPaymentRequestSchema>;

export type NormalizedVerifyPaymentRequest = VerifyPaymentRequest & {
  paymentPayload: ExactPaymentPayload & {
    network: NetworkId;
    amount: string;
    asset: {
      code: string;
      issuer: string;
    };
  };
  paymentRequirements: ExactPaymentRequirements & {
    network: NetworkId;
    amount: string;
    asset?: {
      code: string;
      issuer: string;
    };
  };
};

export function parseVerifyPaymentRequest(
  input: unknown,
  config: AppConfig
): NormalizedVerifyPaymentRequest {
  const parsed = verifyPaymentRequestSchema.safeParse(input);

  if (!parsed.success) {
    throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Payment payload shape is invalid.", {
      details: {
        issues: parsed.error.issues
      }
    });
  }

  const request = parsed.data;
  const payload = request.paymentPayload;
  const requirements = request.paymentRequirements;

  if (!isSupportedNetwork(payload.network) || !isSupportedNetwork(requirements.network)) {
    throw new LumenError("UNSUPPORTED_NETWORK", "Payment network is not supported.");
  }

  if (payload.network !== requirements.network) {
    throw new LumenError("UNSUPPORTED_NETWORK", "Payment network does not match requirements.");
  }

  assertStellarPublicKey(payload.payTo, "paymentPayload.payTo");
  assertStellarPublicKey(requirements.payTo, "paymentRequirements.payTo");

  const normalizedPayloadAmount = normalizeExactAmount(payload.amount);
  const normalizedRequirementAmount = normalizeExactAmount(requirements.amount);
  const normalizedPayloadAsset = {
    code: normalizeAssetCode(payload.asset.code),
    issuer: payload.asset.issuer
  };
  const normalizedRequirementAsset =
    requirements.asset === undefined
      ? undefined
      : {
          code: normalizeAssetCode(requirements.asset.code),
          issuer: requirements.asset.issuer
        };

  requireSupportedAsset(
    config,
    payload.network,
    normalizedPayloadAsset.code,
    normalizedPayloadAsset.issuer
  );

  if (!amountsEqual(normalizedPayloadAmount, normalizedRequirementAmount)) {
    throw new LumenError("AMOUNT_MISMATCH", "Payment amount does not match requirements.");
  }

  if (
    normalizedRequirementAsset !== undefined &&
    (normalizedPayloadAsset.code !== normalizedRequirementAsset.code ||
      normalizedPayloadAsset.issuer !== normalizedRequirementAsset.issuer)
  ) {
    throw new LumenError("ASSET_MISMATCH", "Payment asset does not match requirements.");
  }

  if (payload.payTo !== requirements.payTo) {
    throw new LumenError(
      "RECIPIENT_MISMATCH",
      "Payment recipient does not match the required payTo address."
    );
  }

  if (
    payload.expiresAtLedger !== undefined &&
    request.currentLedger !== undefined &&
    payload.expiresAtLedger <= request.currentLedger
  ) {
    throw new LumenError("AUTH_EXPIRED", "Payment authorization has expired.");
  }

  return {
    ...request,
    paymentPayload: {
      ...payload,
      network: payload.network,
      amount: normalizedPayloadAmount,
      asset: normalizedPayloadAsset
    },
    paymentRequirements: {
      scheme: requirements.scheme,
      network: requirements.network,
      amount: normalizedRequirementAmount,
      payTo: requirements.payTo,
      ...(normalizedRequirementAsset === undefined ? {} : { asset: normalizedRequirementAsset })
    }
  };
}
