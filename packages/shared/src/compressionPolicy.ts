/**
 * API response compression policy with safety limits.
 *
 * Compression can amplify CPU usage or expose sensitive responses through
 * inappropriate shared caching. This module defines size, content-type, and
 * sensitivity-aware compression rules with documented exclusions.
 */

/**
 * Compression configuration with safe defaults.
 */
export type CompressionConfig = {
  /** Enable compression globally */
  enabled: boolean;
  /** Minimum response size (bytes) before compression is considered */
  minSizeBytes: number;
  /** Maximum response size (bytes); responses larger are not compressed */
  maxSizeBytes: number;
  /** Compression level (1-9, lower = faster) */
  compressionLevel: number;
  /** Content-types that are allowed to be compressed */
  allowedContentTypes: string[];
  /** Path patterns that should never be compressed (sensitive data) */
  sensitivePathPatterns: string[];
};

/**
 * Default compression configuration (fail-closed: minimal compression).
 *
 * Compression is ONLY applied when ALL conditions are met:
 * 1. Compression enabled
 * 2. Response size >= minSizeBytes
 * 3. Response size <= maxSizeBytes
 * 4. Content-Type in allowedContentTypes
 * 5. Path NOT in sensitivePathPatterns
 * 6. Response not already compressed
 * 7. Client sends Accept-Encoding
 */
export const defaultCompressionConfig: CompressionConfig = {
  enabled: true,
  minSizeBytes: 1024, // Don't compress small responses (< 1 KB)
  maxSizeBytes: 10 * 1024 * 1024, // Don't compress huge responses (> 10 MB)
  compressionLevel: 6, // Balance between speed and compression ratio
  allowedContentTypes: [
    "application/json",
    "text/plain",
    "text/html",
    "text/javascript",
    "text/css",
    "text/xml",
    "application/xml"
  ],
  sensitivePathPatterns: [
    // Auth and token endpoints (BREACH-style risk)
    "/v1/sellers/login",
    "/v1/sellers/token",
    "/v1/sellers/*/apikeys",
    // Payment and settlement data (PII + secret mixing)
    "/v1/facilitator/verify",
    "/v1/facilitator/settle",
    "/v1/receipts/*",
    "/v1/settlements/*",
    // User-specific data (account information)
    "/v1/sellers/*",
    "/v1/sellers/*/webhooks"
  ]
};

/**
 * Validate compression configuration and apply safe defaults.
 * Returns a configuration that is guaranteed to be safe.
 */
export function validateCompressionConfig(config: Partial<CompressionConfig>): CompressionConfig {
  const merged = { ...defaultCompressionConfig, ...config };

  // Fail-closed: invalid config falls back to safe defaults
  if (typeof merged.enabled !== "boolean") {
    merged.enabled = defaultCompressionConfig.enabled;
  }

  if (typeof merged.minSizeBytes !== "number" || merged.minSizeBytes < 0) {
    merged.minSizeBytes = defaultCompressionConfig.minSizeBytes;
  }

  if (typeof merged.maxSizeBytes !== "number" || merged.maxSizeBytes < merged.minSizeBytes) {
    merged.maxSizeBytes = defaultCompressionConfig.maxSizeBytes;
  }

  if (
    typeof merged.compressionLevel !== "number" ||
    merged.compressionLevel < 1 ||
    merged.compressionLevel > 9
  ) {
    merged.compressionLevel = defaultCompressionConfig.compressionLevel;
  }

  if (
    !Array.isArray(merged.allowedContentTypes) ||
    merged.allowedContentTypes.length === 0
  ) {
    merged.allowedContentTypes = defaultCompressionConfig.allowedContentTypes;
  }

  if (!Array.isArray(merged.sensitivePathPatterns)) {
    merged.sensitivePathPatterns = defaultCompressionConfig.sensitivePathPatterns;
  }

  return merged as CompressionConfig;
}

/**
 * Determine if a response should be compressed.
 *
 * ALL conditions must be true:
 * 1. Compression enabled
 * 2. Content-Type is allowlisted
 * 3. Content-Type is not already compressed
 * 4. Response size is within bounds
 * 5. Path is not in sensitive exclusion list
 * 6. No existing Content-Encoding
 */
export function shouldCompress(
  config: CompressionConfig,
  options: {
    contentType: string | null;
    contentLength: number | null;
    requestPath: string;
    acceptEncoding: string | null;
    existingContentEncoding: string | null;
  }
): boolean {
  // Compression globally disabled
  if (!config.enabled) {
    return false;
  }

  // No Accept-Encoding header
  if (!options.acceptEncoding) {
    return false;
  }

  // Already compressed or binary format
  if (options.existingContentEncoding) {
    return false;
  }

  // Invalid or missing content-type
  if (!options.contentType) {
    return false; // Fail-closed: unknown type
  }

  // Content-type is already compressed or binary
  if (
    isAlreadyCompressed(options.contentType) ||
    isBinaryContentType(options.contentType)
  ) {
    return false;
  }

  // Content-type not in allowlist
  if (!isAllowedContentType(options.contentType, config.allowedContentTypes)) {
    return false;
  }

  // Size checks
  if (options.contentLength === null) {
    return false; // Can't determine size; don't compress
  }

  if (options.contentLength < config.minSizeBytes) {
    return false; // Too small
  }

  if (options.contentLength > config.maxSizeBytes) {
    return false; // Too large
  }

  // Path is sensitive (BREACH protection)
  if (isSensitivePath(options.requestPath, config.sensitivePathPatterns)) {
    return false;
  }

  return true;
}

/**
 * Check if content-type is already compressed
 */
function isAlreadyCompressed(contentType: string): boolean {
  const normalizedType = contentType.toLowerCase();
  return normalizedType.includes("gzip") || normalizedType.includes("deflate") ||
    normalizedType.includes("brotli") || normalizedType.includes("compress");
}

/**
 * Check if content-type is a binary format that should not be compressed
 */
function isBinaryContentType(contentType: string): boolean {
  const normalizedType = contentType.toLowerCase();
  return (
    normalizedType.startsWith("image/") ||
    normalizedType.startsWith("audio/") ||
    normalizedType.startsWith("video/") ||
    normalizedType.includes("zip") ||
    normalizedType.includes("tar") ||
    normalizedType.includes("octet-stream")
  );
}

/**
 * Check if content-type is in the allowlist
 */
function isAllowedContentType(contentType: string, allowed: string[]): boolean {
  const normalizedType = contentType.toLowerCase().split(";")[0]; // Remove charset
  return allowed.some((a) => normalizedType === a.toLowerCase());
}

/**
 * Check if request path matches any sensitive pattern
 * Patterns support wildcards: /v1/resources/* matches /v1/resources/abc
 */
function isSensitivePath(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Simple glob matching: * matches any segment
    const regex = pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, "[^/]*")
      .replace(/\//g, "\\/");
    return new RegExp(`^${regex}$`).test(path);
  });
}

/**
 * Get the appropriate Content-Encoding header value
 */
export function getContentEncodingHeader(acceptEncoding: string): string | null {
  const normalizedAccept = acceptEncoding.toLowerCase();

  // Prefer gzip (most widely supported)
  if (normalizedAccept.includes("gzip")) {
    return "gzip";
  }

  // Fall back to deflate
  if (normalizedAccept.includes("deflate")) {
    return "deflate";
  }

  // Brotli if available
  if (normalizedAccept.includes("br")) {
    return "br";
  }

  // compress (older standard)
  if (normalizedAccept.includes("compress")) {
    return "compress";
  }

  // identity means no compression
  if (normalizedAccept.includes("identity")) {
    return null;
  }

  return null;
}
