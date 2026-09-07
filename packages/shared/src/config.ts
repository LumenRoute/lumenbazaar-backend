import { z } from "zod";

import {
  type NetworkConfig,
  type NetworkId,
  localIssuerPublicKey,
  networkIds,
  stellarPassphrases
} from "./networks.js";

export const runtimeEnvironments = ["local", "testnet", "staging", "mainnet"] as const;

export type RuntimeEnvironment = (typeof runtimeEnvironments)[number];

const booleanEnv = z.preprocess((value) => {
  if (value === undefined) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  return value;
}, z.boolean());

const optionalNonEmptyStringEnv = z
  .preprocess((value) => {
    if (value === "") {
      return undefined;
    }

    return value;
  }, z.string().min(1).optional())
  .optional();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default(process.env.NODE_ENV === "test" ? "test" : "development"),
  LUMEN_ENV: z.enum(runtimeEnvironments).default("local"),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:3000,https://lumenbazaar-frontend.vercel.app"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/lumenbazaar"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  ENABLE_UPTO_SCHEME: booleanEnv.default(false),
  DEFAULT_ASSET_CODE: z.string().min(1).max(12).default("USDC"),
  STELLAR_TESTNET_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  STELLAR_TESTNET_HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
  STELLAR_TESTNET_USDC_ISSUER: z.string().min(1).default(localIssuerPublicKey),
  STELLAR_TESTNET_USDC_CONTRACT_ID: optionalNonEmptyStringEnv,
  STELLAR_TESTNET_UPTO_SESSION_CONTRACT_ID: optionalNonEmptyStringEnv,
  STELLAR_PUBNET_RPC_URL: z.string().url().default("https://mainnet.sorobanrpc.com"),
  STELLAR_PUBNET_HORIZON_URL: z.string().url().default("https://horizon.stellar.org"),
  STELLAR_PUBNET_USDC_ISSUER: z.string().min(1).default(localIssuerPublicKey),
  STELLAR_PUBNET_USDC_CONTRACT_ID: optionalNonEmptyStringEnv,
  STELLAR_PUBNET_UPTO_SESSION_CONTRACT_ID: optionalNonEmptyStringEnv,
  FACILITATOR_ACCOUNT: z.string().min(1).default(localIssuerPublicKey)
});

export type RawEnv = z.input<typeof envSchema>;
export type ParsedEnv = z.output<typeof envSchema>;

export type AppConfig = {
  nodeEnv: ParsedEnv["NODE_ENV"];
  lumenEnv: RuntimeEnvironment;
  api: {
    host: string;
    port: number;
    publicUrl: string;
    corsAllowedOrigins: string[];
  };
  databaseUrl: string;
  redisUrl: string;
  facilitatorAccount: string;
  features: {
    uptoScheme: boolean;
  };
  networks: Record<NetworkId, NetworkConfig>;
};

export function loadConfig(input: RawEnv = process.env as RawEnv): AppConfig {
  const env = envSchema.parse(input);
  const defaultAssetCode = env.DEFAULT_ASSET_CODE.toUpperCase();

  const networks: Record<NetworkId, NetworkConfig> = {
    "stellar:testnet": {
      id: "stellar:testnet",
      displayName: "Stellar Testnet",
      passphrase: stellarPassphrases["stellar:testnet"],
      rpcUrl: env.STELLAR_TESTNET_RPC_URL,
      horizonUrl: env.STELLAR_TESTNET_HORIZON_URL,
      assets: [
        {
          code: defaultAssetCode,
          issuer: env.STELLAR_TESTNET_USDC_ISSUER,
          ...(env.STELLAR_TESTNET_USDC_CONTRACT_ID === undefined
            ? {}
            : { contractId: env.STELLAR_TESTNET_USDC_CONTRACT_ID }),
          decimals: 7
        }
      ],
      ...(env.STELLAR_TESTNET_UPTO_SESSION_CONTRACT_ID === undefined
        ? {}
        : { uptoSessionContractId: env.STELLAR_TESTNET_UPTO_SESSION_CONTRACT_ID })
    },
    "stellar:pubnet": {
      id: "stellar:pubnet",
      displayName: "Stellar Pubnet",
      passphrase: stellarPassphrases["stellar:pubnet"],
      rpcUrl: env.STELLAR_PUBNET_RPC_URL,
      horizonUrl: env.STELLAR_PUBNET_HORIZON_URL,
      assets: [
        {
          code: defaultAssetCode,
          issuer: env.STELLAR_PUBNET_USDC_ISSUER,
          ...(env.STELLAR_PUBNET_USDC_CONTRACT_ID === undefined
            ? {}
            : { contractId: env.STELLAR_PUBNET_USDC_CONTRACT_ID }),
          decimals: 7
        }
      ],
      ...(env.STELLAR_PUBNET_UPTO_SESSION_CONTRACT_ID === undefined
        ? {}
        : { uptoSessionContractId: env.STELLAR_PUBNET_UPTO_SESSION_CONTRACT_ID })
    }
  };

  assertMainnetConfiguration(env, networks);

  return {
    nodeEnv: env.NODE_ENV,
    lumenEnv: env.LUMEN_ENV,
    api: {
      host: env.API_HOST,
      port: env.API_PORT,
      publicUrl: env.API_PUBLIC_URL,
      corsAllowedOrigins: parseCorsAllowedOrigins(env.CORS_ALLOWED_ORIGINS)
    },
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    facilitatorAccount: env.FACILITATOR_ACCOUNT,
    features: {
      uptoScheme: env.ENABLE_UPTO_SCHEME
    },
    networks
  };
}

function assertMainnetConfiguration(env: ParsedEnv, networks: Record<NetworkId, NetworkConfig>) {
  if (env.LUMEN_ENV !== "mainnet") {
    return;
  }

  const pubnetAsset = networks["stellar:pubnet"].assets[0];

  if (pubnetAsset?.issuer === localIssuerPublicKey) {
    throw new Error("STELLAR_PUBNET_USDC_ISSUER must be configured before mainnet startup.");
  }
}

export function listConfiguredNetworks(config: AppConfig) {
  const configuredNetworkIds =
    config.lumenEnv === "mainnet" ? networkIds : (["stellar:testnet"] as const);

  return configuredNetworkIds.map((networkId) => config.networks[networkId]);
}

function parseCorsAllowedOrigins(value: string) {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("CORS_ALLOWED_ORIGINS must include at least one origin.");
  }

  return origins.map((origin) => {
    let url: URL;

    try {
      url = new URL(origin);
    } catch {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }

    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }

    return origin;
  });
}
