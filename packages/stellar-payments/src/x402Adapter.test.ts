import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "@lumenbazaar/shared";
import {
  testAssetContractId,
  testPaymentPayload,
  testPaymentRequirement,
  testPaymentRequest
} from "@lumenbazaar/testkit";

import { type FacilitatorSignerProvider } from "./facilitatorSigner.js";
import { parseVerifyPaymentRequest } from "./paymentPayload.js";
import { createX402StellarAdapter, type X402VerificationInput } from "./x402Adapter.js";

const config = loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: testAssetContractId });
const normalizedRequest = parseVerifyPaymentRequest(testPaymentRequest, config);
const verificationInput: X402VerificationInput = {
  paymentPayload: testPaymentPayload,
  paymentRequirements: testPaymentRequirement,
  normalizedRequest
};
const signerProvider = {
  assertReady: vi.fn(),
  getSigner: vi.fn(),
  getStatus: vi.fn()
} as FacilitatorSignerProvider;

describe("default x402 Stellar adapter", () => {
  it("fails closed while no facilitator implementation is configured", async () => {
    const adapter = createX402StellarAdapter();

    await expect(
      adapter.verifyExact({} as Parameters<typeof adapter.verifyExact>[0])
    ).resolves.toMatchObject({
      adapter: "@x402/stellar",
      failureCode: "SETTLEMENT_FAILED",
      valid: false
    });
    expect(adapter.settleExact).toBeUndefined();
  });
});

describe("official x402 Stellar adapter", () => {
  it("passes the configured network RPC and accepts only an official valid result", async () => {
    const verify = vi.fn().mockResolvedValue({ isValid: true, payer: "GTEST" });
    const createVerifier = vi.fn().mockResolvedValue({ verify, settle: vi.fn() });
    const adapter = createX402StellarAdapter({ config, signerProvider, createVerifier });

    await expect(adapter.verifyExact(verificationInput)).resolves.toEqual({
      adapter: "@x402/stellar",
      valid: true
    });
    expect(createVerifier).toHaveBeenCalledWith({
      network: "stellar:testnet",
      rpcUrl: config.networks["stellar:testnet"].rpcUrl,
      maxTransactionFeeStroops: 50_000,
      inclusionFeeStroops: 100
    });
    expect(verify).toHaveBeenCalledWith(testPaymentPayload, testPaymentRequirement);
  });

  it.each([
    ["invalid_exact_stellar_payload_wrong_operation", "INVALID_PAYMENT_PAYLOAD"],
    ["network_mismatch", "UNSUPPORTED_NETWORK"],
    ["invalid_exact_stellar_payload_wrong_asset", "ASSET_MISMATCH"],
    ["invalid_exact_stellar_payload_wrong_amount", "AMOUNT_MISMATCH"],
    ["invalid_exact_stellar_payload_wrong_recipient", "RECIPIENT_MISMATCH"],
    ["invalid_exact_stellar_payload_missing_payer_signature", "INVALID_SIGNATURE"],
    ["invalid_exact_stellar_signature_expiration_too_far", "AUTH_EXPIRED"],
    ["invalid_exact_stellar_payload_facilitator_is_payer", "INVALID_PAYMENT_PAYLOAD"],
    ["invalid_exact_stellar_payload_facilitator_in_auth", "INVALID_PAYMENT_PAYLOAD"],
    ["invalid_exact_stellar_payload_simulation_failed", "SETTLEMENT_FAILED"]
  ])("maps %s to stable failure code %s", async (invalidReason, failureCode) => {
    const adapter = createX402StellarAdapter({
      config,
      signerProvider,
      createVerifier: async () => ({
        async verify() {
          return { isValid: false, invalidReason };
        },
        async settle() {
          throw new Error("not used");
        }
      })
    });

    await expect(adapter.verifyExact(verificationInput)).resolves.toMatchObject({
      adapter: "@x402/stellar",
      failureCode,
      officialContext: { invalidReason },
      valid: false
    });
  });

  it("fails closed for verifier exceptions and incompatible responses", async () => {
    const throwing = createX402StellarAdapter({
      config,
      signerProvider,
      createVerifier: async () => ({
        async verify() {
          throw new Error("secret-bearing upstream error");
        },
        async settle() {
          throw new Error("not used");
        }
      })
    });
    const incompatible = createX402StellarAdapter({
      config,
      signerProvider,
      createVerifier: async () => ({
        async verify() {
          return { isValid: true } as never;
        },
        async settle() {
          throw new Error("not used");
        }
      })
    });

    const thrownResult = await throwing.verifyExact(verificationInput);
    expect(thrownResult).toMatchObject({ valid: false, failureCode: "SETTLEMENT_FAILED" });
    expect(JSON.stringify(thrownResult)).not.toContain("secret-bearing");
    await expect(incompatible.verifyExact(verificationInput)).resolves.toMatchObject({
      valid: false,
      failureCode: "SETTLEMENT_FAILED"
    });
  });

  it("settles through the official verifier and requires independent RPC finality", async () => {
    const settle = vi.fn().mockResolvedValue({
      success: true,
      transaction: "tx_confirmed",
      network: "stellar:testnet",
      payer: "GTEST"
    });
    const resolveFinality = vi.fn().mockResolvedValue({ status: "confirmed", ledger: 456 });
    const adapter = createX402StellarAdapter({
      config,
      signerProvider,
      createVerifier: async () => ({ verify: vi.fn(), settle }),
      resolveFinality
    });

    await expect(adapter.settleExact?.(verificationInput)).resolves.toEqual({
      adapter: "@x402/stellar",
      status: "confirmed",
      transactionHash: "tx_confirmed",
      ledger: 456
    });
    expect(settle).toHaveBeenCalledWith(testPaymentPayload, testPaymentRequirement);
    expect(resolveFinality).toHaveBeenCalledWith({
      network: "stellar:testnet",
      rpcUrl: config.networks["stellar:testnet"].rpcUrl,
      transactionHash: "tx_confirmed"
    });
  });

  it.each([
    ["invalid_exact_stellar_payload_simulation_failed", "simulation"],
    ["invalid_exact_stellar_payload_fee_exceeds_maximum", "simulation"],
    ["settle_exact_stellar_transaction_submission_failed", "submission"]
  ])("classifies official %s settlement failures as %s", async (errorReason, stage) => {
    const adapter = createX402StellarAdapter({
      config,
      signerProvider,
      createVerifier: async () => ({
        verify: vi.fn(),
        async settle() {
          return {
            success: false,
            transaction: "",
            network: "stellar:testnet",
            errorReason
          };
        }
      }),
      resolveFinality: vi.fn()
    });

    await expect(adapter.settleExact?.(verificationInput)).resolves.toMatchObject({
      status: "failed",
      failureCode: "SETTLEMENT_FAILED",
      officialContext: { stage, errorReason }
    });
  });

  it.each([
    ["pending", "timed_out", "timeout"],
    ["failed", "failed", "failed"]
  ] as const)(
    "maps %s RPC finality to %s settlement state",
    async (finalityStatus, settlementStatus, stage) => {
      const adapter = createX402StellarAdapter({
        config,
        signerProvider,
        createVerifier: async () => ({
          verify: vi.fn(),
          async settle() {
            return {
              success: true,
              transaction: "tx_unconfirmed",
              network: "stellar:testnet",
              payer: "GTEST"
            };
          }
        }),
        resolveFinality: async () => ({ status: finalityStatus })
      });

      await expect(adapter.settleExact?.(verificationInput)).resolves.toMatchObject({
        status: settlementStatus,
        transactionHash: "tx_unconfirmed",
        officialContext: { stage }
      });
    }
  );
});
