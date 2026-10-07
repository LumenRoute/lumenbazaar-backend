import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { listConfiguredNetworks, loadConfig, localIssuerPublicKey } from "./index.js";

describe("loadConfig", () => {
  it("loads local defaults while exposing only testnet", () => {
    const config = loadConfig({});

    expect(config.lumenEnv).toBe("local");
    expect(config.api.port).toBe(3000);
    expect(config.features.uptoScheme).toBe(false);
    expect(config.signer).toEqual({
      provider: "disabled",
      network: "stellar:testnet"
    });
    expect(config.settlement).toEqual({
      maxTransactionFeeStroops: 50_000,
      inclusionFeeStroops: 100
    });
    expect(config.networks["stellar:testnet"].passphrase).toContain("Test SDF Network");
    expect(config.networks["stellar:testnet"].assets[0]).toMatchObject({
      code: "USDC",
      issuer: localIssuerPublicKey,
      decimals: 7
    });
    expect(config.networks["stellar:pubnet"].passphrase).toContain("Public Global Stellar");
    expect(listConfiguredNetworks(config).map((network) => network.id)).toEqual([
      "stellar:testnet"
    ]);
  });

  it("fails startup when a numeric setting is malformed", () => {
    expect(() => loadConfig({ API_PORT: "not-a-number" })).toThrow(ZodError);
    expect(() => loadConfig({ STELLAR_MAX_TRANSACTION_FEE_STROOPS: "0" })).toThrow(ZodError);
    expect(() => loadConfig({ STELLAR_INCLUSION_FEE_STROOPS: "not-a-number" })).toThrow(ZodError);
    expect(() =>
      loadConfig({
        STELLAR_MAX_TRANSACTION_FEE_STROOPS: "100",
        STELLAR_INCLUSION_FEE_STROOPS: "101"
      })
    ).toThrow("must not exceed");
  });

  it("fails closed for mainnet without an explicit pubnet USDC issuer", () => {
    expect(() => loadConfig({ LUMEN_ENV: "mainnet" })).toThrow(
      "STELLAR_PUBNET_USDC_ISSUER must be configured"
    );
  });

  it.each([
    ["local", "stellar:testnet"],
    ["testnet", "stellar:testnet"],
    ["staging", "stellar:testnet"],
    ["mainnet", "stellar:pubnet"]
  ] as const)("uses the %s environment network profile", (lumenEnv, expectedNetwork) => {
    const config = loadConfig({
      LUMEN_ENV: lumenEnv,
      ...(lumenEnv === "local"
        ? {}
        : {
            NODE_ENV: "production",
            API_PUBLIC_URL: `https://api.${lumenEnv}.lumenbazaar.dev`,
            MCP_PUBLIC_URL: `https://mcp.${lumenEnv}.lumenbazaar.dev/mcp`,
            DATABASE_URL: "postgresql://lumenbazaar@postgres:5432/lumenbazaar",
            REDIS_URL: "redis://redis:6379",
            FACILITATOR_ACCOUNT: "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ",
            STELLAR_TESTNET_USDC_ISSUER: "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ"
          }),
      ...(lumenEnv === "mainnet"
        ? { STELLAR_PUBNET_USDC_ISSUER: "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ" }
        : {})
    });

    expect(listConfiguredNetworks(config).map((network) => network.id)).toEqual([expectedNetwork]);
  });

  it("rejects local and placeholder values in hosted environments", () => {
    expect(() => loadConfig({ NODE_ENV: "production", LUMEN_ENV: "testnet" })).toThrow(
      "API_PUBLIC_URL must not use a local or placeholder value in testnet"
    );

    expect(() =>
      loadConfig({ NODE_ENV: "production", LUMEN_ENV: "testnet" }, { allowPlaceholders: true })
    ).not.toThrow();
  });

  it("parses boolean feature flags explicitly", () => {
    expect(loadConfig({ ENABLE_UPTO_SCHEME: "true" }).features.uptoScheme).toBe(true);
    expect(loadConfig({ ENABLE_UPTO_SCHEME: "0" }).features.uptoScheme).toBe(false);
  });

  it("rejects test signers and signer networks that do not match the active network", () => {
    expect(() => loadConfig({ FACILITATOR_SIGNER_PROVIDER: "test" } as never)).toThrow(ZodError);
    expect(() =>
      loadConfig({
        FACILITATOR_SIGNER_PROVIDER: "environment",
        FACILITATOR_SIGNER_NETWORK: "stellar:pubnet"
      })
    ).toThrow("FACILITATOR_SIGNER_NETWORK must match the active Stellar network");
  });

  it("requires a key version for a hosted environment signer", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        LUMEN_ENV: "testnet",
        API_PUBLIC_URL: "https://api.testnet.lumenbazaar.dev",
        MCP_PUBLIC_URL: "https://mcp.testnet.lumenbazaar.dev/mcp",
        DATABASE_URL: "postgresql://lumenbazaar@postgres:5432/lumenbazaar",
        REDIS_URL: "redis://redis:6379",
        FACILITATOR_ACCOUNT: "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ",
        STELLAR_TESTNET_USDC_ISSUER: "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ",
        FACILITATOR_SIGNER_PROVIDER: "environment",
        FACILITATOR_SIGNER_NETWORK: "stellar:testnet"
      })
    ).toThrow("FACILITATOR_SIGNING_KEY_VERSION is required");
  });

  it("parses explicit CORS origins", () => {
    const config = loadConfig({
      CORS_ALLOWED_ORIGINS: "http://localhost:3000,https://frontend.example.test"
    });

    expect(config.api.corsAllowedOrigins).toEqual([
      "http://localhost:3000",
      "https://frontend.example.test"
    ]);
    expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: "*" })).toThrow(
      "CORS_ALLOWED_ORIGINS contains an invalid origin"
    );
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
