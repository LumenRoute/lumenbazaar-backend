import {
  LumenError,
  type AppConfig,
  type NetworkConfig,
  type NetworkId,
  type SupportedAsset,
  isSupportedNetwork,
  normalizeAssetCode
} from "@lumenbazaar/shared";

export type StellarRpcClientRef = {
  kind: "stellar-rpc";
  network: NetworkId;
  url: string;
  passphrase: string;
};

export type HorizonClientRef = {
  kind: "horizon";
  network: NetworkId;
  url: string;
  passphrase: string;
};

export function getNetworkConfig(config: AppConfig, network: string): NetworkConfig {
  if (!isSupportedNetwork(network)) {
    throw new LumenError("UNSUPPORTED_NETWORK", `Network ${network} is not supported.`);
  }

  return config.networks[network];
}

export function createRpcClient(config: AppConfig, network: string): StellarRpcClientRef {
  const networkConfig = getNetworkConfig(config, network);

  return {
    kind: "stellar-rpc",
    network: networkConfig.id,
    url: networkConfig.rpcUrl,
    passphrase: networkConfig.passphrase
  };
}

export function createHorizonClient(config: AppConfig, network: string): HorizonClientRef {
  const networkConfig = getNetworkConfig(config, network);

  return {
    kind: "horizon",
    network: networkConfig.id,
    url: networkConfig.horizonUrl,
    passphrase: networkConfig.passphrase
  };
}

export function findSupportedAsset(
  config: AppConfig,
  network: string,
  assetCode: string,
  assetIssuer: string
): SupportedAsset | undefined {
  const networkConfig = getNetworkConfig(config, network);
  const normalizedCode = normalizeAssetCode(assetCode);

  return networkConfig.assets.find(
    (asset) => normalizeAssetCode(asset.code) === normalizedCode && asset.issuer === assetIssuer
  );
}

export function requireSupportedAsset(
  config: AppConfig,
  network: string,
  assetCode: string,
  assetIssuer: string
) {
  const asset = findSupportedAsset(config, network, assetCode, assetIssuer);

  if (asset === undefined) {
    throw new LumenError(
      "UNSUPPORTED_ASSET",
      `Asset ${normalizeAssetCode(assetCode)} is not supported on ${network}.`
    );
  }

  return asset;
}
