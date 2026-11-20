import { createHash } from "node:crypto";

/**
 * Resource Fingerprint v1
 *
 * Computes a stable fingerprint from canonical resource properties to detect
 * semantically duplicate resources. The fingerprint is versioned to allow
 * algorithm updates without breaking existing collision detection.
 *
 * Fingerprint inputs (v1):
 * - sellerId: The canonical seller, immutable throughout the resource's lifetime
 * - url: The canonical endpoint URL (normalized to lowercase)
 * - network: The Stellar network (testnet, pubnet)
 * - assetCode: The asset code (normalized to uppercase)
 * - assetIssuer: The Stellar account ID (canonical issuer)
 * - amount: The exact payment amount (normalized)
 * - payTo: The payment destination (Stellar account ID)
 *
 * Version:
 * - v1: Initial stable version (used indefinitely unless updated)
 *
 * Collisions indicate resources with identical payment terms and endpoint.
 * Minor metadata changes (name, description, schemas) do not affect the fingerprint.
 */

export const RESOURCE_FINGERPRINT_VERSION = 1;

export type ResourceFingerprint = {
  /** The fingerprint version used to compute the hash */
  version: number;
  /** SHA-256 hex digest of concatenated canonical inputs */
  hash: string;
};

export type ResourceFingerprintInputs = {
  sellerId: string;
  url: string;
  network: string;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  payTo: string;
};

/**
 * Compute a versioned fingerprint for a resource.
 * Input normalization ensures that equivalent resources produce identical hashes
 * even if metadata was modified before submission.
 *
 * @param inputs The canonical resource properties
 * @returns The fingerprint with version and hash
 */
export function computeResourceFingerprint(inputs: ResourceFingerprintInputs): ResourceFingerprint {
  const canonical = normalizeFingerprinterInputs(inputs);
  return {
    version: RESOURCE_FINGERPRINT_VERSION,
    hash: hashFingerprintInputs(canonical)
  };
}

/**
 * Normalize fingerprint inputs to ensure deterministic hashing.
 * - URLs are lowercased (domains are case-insensitive per RFC 3986)
 * - Asset codes are uppercased (ISO 4217 standard)
 * - Account IDs are left as-is (Stellar addresses are already canonical)
 * - Amounts are left as-is (already normalized by payment validation)
 */
function normalizeFingerprinterInputs(inputs: ResourceFingerprintInputs): ResourceFingerprintInputs {
  return {
    sellerId: inputs.sellerId,
    url: inputs.url.toLowerCase(),
    network: inputs.network,
    assetCode: inputs.assetCode.toUpperCase(),
    assetIssuer: inputs.assetIssuer,
    amount: inputs.amount,
    payTo: inputs.payTo
  };
}

/**
 * Hash normalized inputs to a SHA-256 digest.
 * Inputs are concatenated in a deterministic order, each prefixed with length
 * to avoid collision between field boundaries.
 *
 * Example for illustration:
 *   version=1: "3seller_c64seller_id8urlhttps://...7networkstellar:testnet7assetCodeXLM..."
 */
function hashFingerprintInputs(inputs: ResourceFingerprintInputs): string {
  const parts = [
    `1`, // version as first byte so algorithm changes produce different hashes
    encodeField("sellerId", inputs.sellerId),
    encodeField("url", inputs.url),
    encodeField("network", inputs.network),
    encodeField("assetCode", inputs.assetCode),
    encodeField("assetIssuer", inputs.assetIssuer),
    encodeField("amount", inputs.amount),
    encodeField("payTo", inputs.payTo)
  ];

  const combined = parts.join("");
  return createHash("sha256").update(combined, "utf-8").digest("hex");
}

/**
 * Encode a field name and value as "nameLength:name|valueLength:value|"
 * This prevents collisions at field boundaries (e.g., "ab" + "c" vs "a" + "bc").
 */
function encodeField(name: string, value: string): string {
  return `${name.length}:${name}|${value.length}:${value}|`;
}

/**
 * Check if two resources have the same fingerprint.
 * Resources with matching fingerprints are duplicates.
 *
 * @param fp1 First fingerprint
 * @param fp2 Second fingerprint
 * @returns true if the fingerprints match (both version and hash)
 */
export function fingerprintsMatch(fp1: ResourceFingerprint, fp2: ResourceFingerprint): boolean {
  return fp1.version === fp2.version && fp1.hash === fp2.hash;
}
