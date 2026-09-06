import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { loadConfig, localIssuerPublicKey } from "./index.js";

describe("loadConfig", () => {
  it("loads local defaults with testnet and pubnet network settings", () => {
    const config = loadConfig({});

    expect(config.lumenEnv).toBe("local");
    expect(config.api.port).toBe(3000);
    expect(config.features.uptoScheme).toBe(false);
    expect(config.networks["stellar:testnet"].passphrase).toContain("Test SDF Network");
    expect(config.networks["stellar:testnet"].assets[0]).toMatchObject({
      code: "USDC",
      issuer: localIssuerPublicKey,
      decimals: 7
    });
    expect(config.networks["stellar:pubnet"].passphrase).toContain("Public Global Stellar");
  });

  it("fails startup when a numeric setting is malformed", () => {
    expect(() => loadConfig({ API_PORT: "not-a-number" })).toThrow(ZodError);
  });

  it("fails closed for mainnet without an explicit pubnet USDC issuer", () => {
    expect(() => loadConfig({ LUMEN_ENV: "mainnet" })).toThrow(
      "STELLAR_PUBNET_USDC_ISSUER must be configured"
    );
  });

  it("parses boolean feature flags explicitly", () => {
    expect(loadConfig({ ENABLE_UPTO_SCHEME: "true" }).features.uptoScheme).toBe(true);
    expect(loadConfig({ ENABLE_UPTO_SCHEME: "0" }).features.uptoScheme).toBe(false);
  });

  it("loads optional contract IDs for capped session deployments", () => {
    const config = loadConfig({
      STELLAR_TESTNET_USDC_CONTRACT_ID: "CDLZUSDCTOKENCONTRACT0000000000000000000000000000000000",
      STELLAR_TESTNET_UPTO_SESSION_CONTRACT_ID:
        "CDLZUPTOSESSIONCONTRACT000000000000000000000000000000000"
    });

    expect(config.networks["stellar:testnet"].assets[0]).toMatchObject({
      contractId: "CDLZUSDCTOKENCONTRACT0000000000000000000000000000000000"
    });
    expect(config.networks["stellar:testnet"].uptoSessionContractId).toBe(
      "CDLZUPTOSESSIONCONTRACT000000000000000000000000000000000"
    );
    expect(
      loadConfig({ STELLAR_TESTNET_USDC_CONTRACT_ID: "" }).networks["stellar:testnet"].assets[0]
    ).not.toHaveProperty("contractId");
  });
});
