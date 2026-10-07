import { describe, expect, it } from "vitest";

import {
  parseDeploymentCheckArgs,
  parseEnvFile,
  validateTestnetDeploymentEnv
} from "./deployment-check.js";

const validEnv = {
  NODE_ENV: "production",
  LUMEN_ENV: "testnet",
  API_PUBLIC_URL: "https://api.testnet.lumenbazaar.dev",
  MCP_PUBLIC_URL: "https://mcp.testnet.lumenbazaar.dev/mcp",
  DATABASE_URL: "postgresql://postgres:postgres@postgres:5432/lumenbazaar",
  REDIS_URL: "redis://redis:6379",
  DEFAULT_ASSET_CODE: "USDC",
  STELLAR_TESTNET_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_TESTNET_HORIZON_URL: "https://horizon-testnet.stellar.org",
  STELLAR_TESTNET_USDC_ISSUER: "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ",
  STELLAR_TESTNET_USDC_CONTRACT_ID: "CB256KDRXDO2FYJN3YBYZE5KCU46WIIE67DRP5T7HI45DRH2GM6YOJFS",
  FACILITATOR_ACCOUNT: "GCYEX7MPJL64ZJ7ABZSPRC7YEBSI7OMC62FFEVFHCZFREBOYJPQDUCYJ"
};

describe("testnet deployment check", () => {
  it("parses dotenv style env files", () => {
    expect(
      parseEnvFile(`
        # comment
        NODE_ENV=production
        API_PUBLIC_URL="https://api.testnet.lumenbazaar.dev"
        REDIS_URL='redis://redis:6379'
      `)
    ).toEqual({
      API_PUBLIC_URL: "https://api.testnet.lumenbazaar.dev",
      NODE_ENV: "production",
      REDIS_URL: "redis://redis:6379"
    });
  });

  it("validates testnet deployment settings and derives public endpoints", () => {
    const result = validateTestnetDeploymentEnv(validEnv, { allowPlaceholders: false });

    expect(result).toMatchObject({
      ok: true,
      endpoints: {
        api: {
          health: "https://api.testnet.lumenbazaar.dev/health",
          readiness: "https://api.testnet.lumenbazaar.dev/ready",
          metrics: "https://api.testnet.lumenbazaar.dev/metrics",
          openapi: "https://api.testnet.lumenbazaar.dev/openapi.json",
          supported: "https://api.testnet.lumenbazaar.dev/v1/supported"
        },
        mcp: {
          health: "https://mcp.testnet.lumenbazaar.dev/health",
          streamableHttp: "https://mcp.testnet.lumenbazaar.dev/mcp"
        }
      }
    });
  });

  it("fails closed on placeholders unless examples are explicitly allowed", () => {
    const placeholderEnv = {
      ...validEnv,
      API_PUBLIC_URL: "https://api.testnet.lumenbazaar.example",
      MCP_PUBLIC_URL: "https://mcp.testnet.lumenbazaar.example/mcp"
    };

    expect(
      validateTestnetDeploymentEnv(placeholderEnv, { allowPlaceholders: false }).errors
    ).toContain("API_PUBLIC_URL still contains a placeholder value.");
    expect(
      validateTestnetDeploymentEnv(placeholderEnv, { allowPlaceholders: true }).warnings
    ).toContain("API_PUBLIC_URL uses a placeholder value.");
  });

  it("parses CLI arguments", () => {
    expect(
      parseDeploymentCheckArgs(["--env-file", ".env.testnet", "--allow-placeholders"])
    ).toEqual({
      allowPlaceholders: true,
      envFile: ".env.testnet"
    });
  });
});
