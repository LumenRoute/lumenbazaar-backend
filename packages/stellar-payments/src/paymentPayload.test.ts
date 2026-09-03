import { describe, expect, it } from "vitest";

import { LumenError, loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { normalizeExactAmount, parseVerifyPaymentRequest } from "./index.js";

const payTo = localIssuerPublicKey;

function validPayload() {
  return {
    paymentPayload: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: {
        code: "usdc",
        issuer: localIssuerPublicKey
      },
      amount: "0.0500000",
      payTo,
      expiresAtLedger: 100,
      authorization: {
        signature: "sig"
      }
    },
    paymentRequirements: {
      scheme: "exact",
      network: "stellar:testnet",
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo
    },
    currentLedger: 99
  };
}

describe("payment payload model", () => {
  const config = loadConfig({});

  it("normalizes exact amounts to seven-decimal Stellar precision", () => {
    expect(normalizeExactAmount("1.2300000")).toBe("1.23");
    expect(normalizeExactAmount("10")).toBe("10");
    expect(() => normalizeExactAmount("0")).toThrow("greater than zero");
    expect(() => normalizeExactAmount("1.00000001")).toThrow("positive decimal string");
  });

  it("parses and normalizes valid exact payment requests", () => {
    expect(parseVerifyPaymentRequest(validPayload(), config)).toMatchObject({
      paymentPayload: {
        network: "stellar:testnet",
        amount: "0.05",
        asset: {
          code: "USDC"
        }
      }
    });
  });

  it.each([
    ["UNSUPPORTED_NETWORK", { paymentPayload: { network: "stellar:futurenet" } }],
    ["UNSUPPORTED_ASSET", { paymentPayload: { asset: { code: "EURC", issuer: payTo } } }],
    ["AMOUNT_MISMATCH", { paymentPayload: { amount: "0.06" } }],
    [
      "RECIPIENT_MISMATCH",
      { paymentRequirements: { payTo: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" } }
    ],
    ["AUTH_EXPIRED", { currentLedger: 101 }]
  ])("returns %s for invalid exact payment input", (code, override) => {
    const input = mergePaymentOverride(validPayload(), override);

    expect(() => parseVerifyPaymentRequest(input, config)).toThrow(LumenError);

    try {
      parseVerifyPaymentRequest(input, config);
    } catch (error) {
      expect((error as LumenError).code).toBe(code);
    }
  });
});

function mergePaymentOverride(
  base: ReturnType<typeof validPayload>,
  override: Record<string, unknown>
) {
  return {
    ...base,
    ...override,
    paymentPayload: {
      ...base.paymentPayload,
      ...((override.paymentPayload as Record<string, unknown> | undefined) ?? {})
    },
    paymentRequirements: {
      ...base.paymentRequirements,
      ...((override.paymentRequirements as Record<string, unknown> | undefined) ?? {})
    }
  };
}
