import {
  PaymentPayloadV2Schema,
  PaymentRequirementsV2Schema,
  type PaymentPayloadV2,
  type PaymentRequirementsV2
} from "@x402/core/schemas";
import { type PaymentPayload, type PaymentRequirements } from "@x402/core/types";

import {
  LumenError,
  type AppConfig,
  type NetworkId,
  isSupportedNetwork,
  listConfiguredNetworks
} from "@lumenbazaar/shared";

import { assertStellarPublicKey } from "./addresses.js";
import { canonicalJson } from "./hash.js";

export type ExactStellarPaymentRequirements = PaymentRequirements & {
  scheme: "exact";
  network: NetworkId;
  asset: string;
  extra: Record<string, unknown>;
};

export type ExactStellarPaymentPayload = PaymentPayload & {
  x402Version: 2;
  accepted: ExactStellarPaymentRequirements;
  payload: {
    transaction: string;
  };
};

export type VerifyPaymentRequest = {
  x402Version: 2;
  paymentPayload: ExactStellarPaymentPayload;
  paymentRequirements: ExactStellarPaymentRequirements;
};

export type NormalizedVerifyPaymentRequest = VerifyPaymentRequest & {
  network: NetworkId;
  amount: string;
  payTo: string;
  asset: {
    code: string;
    issuer: string;
    contractId: string;
    decimals: number;
  };
};

export function parseVerifyPaymentRequest(
  input: unknown,
  config: AppConfig
): NormalizedVerifyPaymentRequest {
  const request = parseRequestContainer(input);
  const paymentPayload = parsePaymentPayloadV2(request.paymentPayload);
  const paymentRequirements = parsePaymentRequirementsV2(request.paymentRequirements);

  if (canonicalJson(paymentPayload.accepted) !== canonicalJson(paymentRequirements)) {
    throw protocolError(
      "Payment payload selection does not match payment requirements.",
      "accepted"
    );
  }

  if (paymentRequirements.scheme !== "exact") {
    throw protocolError("Stellar only supports the exact scheme in x402 v2.", "scheme");
  }

  if (!isSupportedNetwork(paymentRequirements.network)) {
    throw new LumenError("UNSUPPORTED_NETWORK", "Payment network is not supported.", {
      details: { network: paymentRequirements.network, x402Version: 2 }
    });
  }

  const network = listConfiguredNetworks(config).find(
    (candidate) => candidate.id === paymentRequirements.network
  );
  if (network === undefined) {
    throw new LumenError("UNSUPPORTED_NETWORK", "Payment network is not enabled.", {
      details: { network: paymentRequirements.network, x402Version: 2 }
    });
  }

  const asset = network.assets.find(
    (candidate) => candidate.contractId === paymentRequirements.asset
  );
  if (asset?.contractId === undefined) {
    throw new LumenError("UNSUPPORTED_ASSET", "SEP-41 asset contract is not supported.", {
      details: {
        asset: paymentRequirements.asset,
        network: paymentRequirements.network,
        x402Version: 2
      }
    });
  }

  assertPositiveAtomicAmount(paymentRequirements.amount);
  assertStellarPublicKey(paymentRequirements.payTo, "paymentRequirements.payTo");
  const transaction = paymentPayload.payload.transaction;
  if (typeof transaction !== "string") {
    throw protocolError(
      "Stellar exact payload must contain a transaction string.",
      "paymentPayload.payload.transaction"
    );
  }
  assertBase64Transaction(transaction);

  return {
    x402Version: 2,
    paymentPayload: paymentPayload as ExactStellarPaymentPayload,
    paymentRequirements: paymentRequirements as ExactStellarPaymentRequirements,
    network: paymentRequirements.network,
    amount: paymentRequirements.amount,
    payTo: paymentRequirements.payTo,
    asset: {
      code: asset.code,
      issuer: asset.issuer,
      contractId: asset.contractId,
      decimals: asset.decimals
    }
  };
}

function parseRequestContainer(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw protocolError("x402 facilitator request must be an object.", "request");
  }

  const request = input as Record<string, unknown>;
  if (request.x402Version === 1 || hasLegacyExactShape(request.paymentPayload)) {
    throw protocolError("x402 v1 Stellar exact payloads are not supported.", "x402Version", 1);
  }
  if (request.x402Version !== 2) {
    throw protocolError("x402Version must be 2.", "x402Version", request.x402Version);
  }

  return {
    paymentPayload: request.paymentPayload,
    paymentRequirements: request.paymentRequirements
  };
}

function parsePaymentPayloadV2(input: unknown): PaymentPayloadV2 {
  const parsed = PaymentPayloadV2Schema.safeParse(input);
  if (!parsed.success) {
    throw protocolError("PAYMENT-SIGNATURE payload is not valid x402 v2.", "paymentPayload", 2, {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}

function parsePaymentRequirementsV2(input: unknown): PaymentRequirementsV2 {
  const parsed = PaymentRequirementsV2Schema.safeParse(input);
  if (!parsed.success) {
    throw protocolError("Payment requirements are not valid x402 v2.", "paymentRequirements", 2, {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}

function assertPositiveAtomicAmount(amount: string) {
  if (!/^[1-9]\d*$/.test(amount)) {
    throw new LumenError(
      "INVALID_PAYMENT_PAYLOAD",
      "Payment amount must be a positive atomic-unit integer.",
      { details: { field: "paymentRequirements.amount", x402Version: 2 } }
    );
  }
}

function assertBase64Transaction(transaction: string) {
  try {
    const decoded = Buffer.from(transaction, "base64");
    const normalizedInput = transaction.replace(/=+$/, "");
    const normalizedOutput = decoded.toString("base64").replace(/=+$/, "");
    if (decoded.length === 0 || normalizedInput !== normalizedOutput) {
      throw new Error("invalid base64");
    }
  } catch {
    throw protocolError(
      "Stellar exact payload transaction must be canonical base64.",
      "paymentPayload.payload.transaction"
    );
  }
}

function hasLegacyExactShape(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).scheme === "exact"
  );
}

function protocolError(
  message: string,
  field: string,
  receivedVersion: unknown = 2,
  officialContext: Record<string, unknown> = {}
) {
  return new LumenError("INVALID_PAYMENT_PAYLOAD", message, {
    details: {
      field,
      receivedVersion,
      requiredVersion: 2,
      ...officialContext
    }
  });
}
