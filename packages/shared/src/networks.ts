export const networkIds = ["stellar:testnet", "stellar:pubnet"] as const;

export type NetworkId = (typeof networkIds)[number];

export type SupportedAsset = {
  code: string;
  issuer: string;
  contractId?: string;
  decimals: number;
};

export type NetworkConfig = {
  id: NetworkId;
  displayName: string;
  passphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  assets: SupportedAsset[];
  uptoSessionContractId?: string;
};

export const stellarPassphrases: Record<NetworkId, string> = {
  "stellar:testnet": "Test SDF Network ; September 2015",
  "stellar:pubnet": "Public Global Stellar Network ; September 2015"
};

export const localIssuerPublicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export function isSupportedNetwork(network: string): network is NetworkId {
  return networkIds.includes(network as NetworkId);
}

export function normalizeAssetCode(code: string) {
  return code.trim().toUpperCase();
}

export function assetKey(asset: Pick<SupportedAsset, "code" | "issuer">) {
  return `${normalizeAssetCode(asset.code)}:${asset.issuer}`;
}
