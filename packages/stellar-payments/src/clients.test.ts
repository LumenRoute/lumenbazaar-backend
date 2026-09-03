import { describe, expect, it } from "vitest";

import { loadConfig, localIssuerPublicKey } from "@lumenbazaar/shared";

import { createHorizonClient, createRpcClient, requireSupportedAsset } from "./clients.js";

describe("Stellar client layer", () => {
  const config = loadConfig({});

  it("selects testnet and pubnet clients from explicit configuration", () => {
    expect(createRpcClient(config, "stellar:testnet")).toMatchObject({
      kind: "stellar-rpc",
      network: "stellar:testnet",
      url: "https://soroban-testnet.stellar.org"
    });
    expect(createHorizonClient(config, "stellar:pubnet")).toMatchObject({
      kind: "horizon",
      network: "stellar:pubnet",
      url: "https://horizon.stellar.org"
    });
  });

  it("rejects unsupported networks and assets with stable codes", () => {
    expect(() => createRpcClient(config, "stellar:futurenet")).toThrow("not supported");
    expect(() =>
      requireSupportedAsset(config, "stellar:testnet", "EURC", localIssuerPublicKey)
    ).toThrow("is not supported");
  });

  it("normalizes asset code lookup", () => {
    expect(requireSupportedAsset(config, "stellar:testnet", "usdc", localIssuerPublicKey)).toEqual({
      code: "USDC",
      issuer: localIssuerPublicKey,
      decimals: 7
    });
  });
});
