import { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { createGzip, createDeflate } from "node:zlib";
import { promisify } from "node:util";

import {
  type CompressionConfig,
  validateCompressionConfig,
  shouldCompress,
  getContentEncodingHeader,
  defaultCompressionConfig
} from "@lumenbazaar/shared";

/**
 * Register compression middleware with safety limits
 */
export function registerCompressionMiddleware(
  app: FastifyInstance,
  config: Partial<CompressionConfig> = {}
) {
  const validatedConfig = validateCompressionConfig(config);

  app.addHook("onSend", async (request, reply, payload) => {
    // Skip compression for certain HTTP methods
    if (request.method === "HEAD" || request.method === "DELETE") {
      return payload;
    }

    // Skip if no payload
    if (!payload || payload.length === 0) {
      return payload;
    }

    // Skip for 204 No Content and 304 Not Modified
    if (reply.statusCode === 204 || reply.statusCode === 304) {
      return payload;
    }

    // Skip for streaming responses
    if (reply.hasHeader("transfer-encoding")) {
      return payload;
    }

    // Get headers
    const contentType = reply.getHeader("content-type") as string | null;
    const contentLength = Buffer.byteLength(payload);
    const acceptEncoding = request.headers["accept-encoding"] as string | null;
    const existingEncoding = reply.getHeader("content-encoding") as string | null;

    // Determine if compression should be applied
    if (
      !shouldCompress(validatedConfig, {
        contentType,
        contentLength,
        requestPath: request.url,
        acceptEncoding,
        existingContentEncoding: existingEncoding
      })
    ) {
      return payload;
    }

    // Get appropriate encoding
    const encoding = getContentEncodingHeader(acceptEncoding || "");
    if (!encoding) {
      return payload;
    }

    // Compress payload
    let compressed: Buffer;
    try {
      compressed = await compressBuffer(payload, encoding, validatedConfig.compressionLevel);
    } catch (error) {
      // Fail-closed: if compression fails, send uncompressed
      console.error("Compression error:", error);
      return payload;
    }

    // Only use compressed version if it's actually smaller
    if (compressed.length >= contentLength) {
      return payload;
    }

    // Set compression headers
    reply.header("Content-Encoding", encoding);
    reply.header("Vary", "Accept-Encoding");

    // Update content-length (important for clients)
    reply.header("Content-Length", compressed.length.toString());

    return compressed;
  });
}

/**
 * Compress buffer using specified encoding
 */
async function compressBuffer(
  buffer: Buffer,
  encoding: string,
  level: number
): Promise<Buffer> {
  const gzip = promisify(require("node:zlib").gzip);
  const deflate = promisify(require("node:zlib").deflate);

  switch (encoding.toLowerCase()) {
    case "gzip":
      return gzip(buffer, { level });
    case "deflate":
      return deflate(buffer, { level });
    case "br":
      // Brotli requires Node 10.16+; gracefully degrade if unavailable
      try {
        const brotli = promisify(require("node:zlib").brotliCompress);
        return brotli(buffer, { params: { [require("node:zlib").constants.BROTLI_PARAM_QUALITY]: level } });
      } catch {
        // Fall back to gzip
        return gzip(buffer, { level });
      }
    case "compress":
      // Legacy LZW compression; fall back to deflate
      return deflate(buffer, { level });
    default:
      return buffer; // No compression
  }
}

/**
 * Helper to enable compression in app.ts
 */
export function createCompressionConfig(): CompressionConfig {
  return {
    ...defaultCompressionConfig,
    // Customize from environment if needed
    enabled: process.env.API_COMPRESSION_ENABLED !== "false",
    minSizeBytes: parseInt(process.env.API_COMPRESSION_MIN_SIZE_BYTES || "1024", 10),
    maxSizeBytes: parseInt(process.env.API_COMPRESSION_MAX_SIZE_BYTES || "10485760", 10),
    compressionLevel: parseInt(process.env.API_COMPRESSION_LEVEL || "6", 10)
  };
}
