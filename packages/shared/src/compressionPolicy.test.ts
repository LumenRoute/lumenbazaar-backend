import { describe, it, expect } from "vitest";
import {
  shouldCompress,
  validateCompressionConfig,
  getContentEncodingHeader,
  defaultCompressionConfig
} from "./compressionPolicy.js";

describe("Compression Policy", () => {
  describe("Config Validation", () => {
    it("uses defaults for invalid config", () => {
      const config = validateCompressionConfig({
        minSizeBytes: -100,
        maxSizeBytes: 500,
        compressionLevel: 15
      });

      expect(config.minSizeBytes).toBe(defaultCompressionConfig.minSizeBytes);
      expect(config.maxSizeBytes).toBe(defaultCompressionConfig.maxSizeBytes);
      expect(config.compressionLevel).toBe(defaultCompressionConfig.compressionLevel);
    });

    it("preserves valid config", () => {
      const valid = {
        minSizeBytes: 512,
        maxSizeBytes: 5000000,
        compressionLevel: 4
      };

      const config = validateCompressionConfig(valid);
      expect(config.minSizeBytes).toBe(512);
      expect(config.maxSizeBytes).toBe(5000000);
      expect(config.compressionLevel).toBe(4);
    });
  });

  describe("Compression Decision", () => {
    const config = validateCompressionConfig({});

    it("does not compress when globally disabled", () => {
      const disabled = { ...config, enabled: false };

      const result = shouldCompress(disabled, {
        contentType: "application/json",
        contentLength: 5000,
        requestPath: "/v1/resources",
        acceptEncoding: "gzip",
        existingContentEncoding: null
      });

      expect(result).toBe(false);
    });

    it("does not compress without Accept-Encoding", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: null,
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("does not compress already-compressed response", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: "gzip"
        })
      ).toBe(false);
    });

    it("does not compress response smaller than minimum", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 100, // Below minSizeBytes (1024)
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("does not compress response larger than maximum", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 11 * 1024 * 1024, // Above maxSizeBytes (10 MB)
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("does not compress disallowed content-type", () => {
      expect(
        shouldCompress(config, {
          contentType: "image/png",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("does not compress sensitive paths (BREACH protection)", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/facilitator/verify",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);

      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/sellers/login",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);

      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/receipts/abc123",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("compresses normal JSON responses", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(true);

      expect(
        shouldCompress(config, {
          contentType: "text/plain; charset=utf-8",
          contentLength: 2000,
          requestPath: "/v1/discovery",
          acceptEncoding: "deflate",
          existingContentEncoding: null
        })
      ).toBe(true);
    });

    it("does not compress binary formats", () => {
      expect(
        shouldCompress(config, {
          contentType: "image/jpeg",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);

      expect(
        shouldCompress(config, {
          contentType: "application/octet-stream",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("does not compress when content-length is unknown", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: null,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });
  });

  describe("Content-Encoding Header", () => {
    it("prefers gzip", () => {
      expect(getContentEncodingHeader("gzip, deflate")).toBe("gzip");
      expect(getContentEncodingHeader("deflate, gzip")).toBe("gzip");
    });

    it("falls back to deflate", () => {
      expect(getContentEncodingHeader("deflate")).toBe("deflate");
    });

    it("handles Brotli", () => {
      expect(getContentEncodingHeader("br, gzip")).toBe("gzip"); // Prefers gzip
      expect(getContentEncodingHeader("br")).toBe("br");
    });

    it("handles identity (no compression)", () => {
      expect(getContentEncodingHeader("identity")).toBeNull();
    });

    it("returns null for unknown encoding", () => {
      expect(getContentEncodingHeader("unknown")).toBeNull();
    });

    it("is case-insensitive", () => {
      expect(getContentEncodingHeader("GZIP")).toBe("gzip");
      expect(getContentEncodingHeader("Deflate")).toBe("deflate");
    });
  });

  describe("Sensitive Path Patterns", () => {
    const config = validateCompressionConfig({});

    it("matches auth endpoints", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/sellers/login",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);

      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/sellers/token",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("matches payment endpoints", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/facilitator/verify",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("matches wildcard patterns", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/receipts/id123",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);

      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/sellers/seller_xyz/webhooks",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("does not match non-sensitive paths", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(true);

      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/discovery",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(true);
    });
  });

  describe("Content-Type Allowlist", () => {
    const config = validateCompressionConfig({});

    it("allows JSON", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(true);
    });

    it("allows text types", () => {
      expect(
        shouldCompress(config, {
          contentType: "text/plain",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(true);
    });

    it("rejects image/audio/video", () => {
      expect(
        shouldCompress(config, {
          contentType: "image/png",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);

      expect(
        shouldCompress(config, {
          contentType: "audio/mpeg",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(false);
    });

    it("handles charset in content-type", () => {
      expect(
        shouldCompress(config, {
          contentType: "application/json; charset=utf-8",
          contentLength: 5000,
          requestPath: "/v1/resources",
          acceptEncoding: "gzip",
          existingContentEncoding: null
        })
      ).toBe(true);
    });
  });
});
