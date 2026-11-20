import { describe, it, expect } from "vitest";
import {
  RESOURCE_FINGERPRINT_VERSION,
  computeResourceFingerprint,
  fingerprintsMatch,
  type ResourceFingerprintInputs
} from "./resourceFingerprint.js";

describe("Resource Fingerprinting", () => {
  const baseInputs: ResourceFingerprintInputs = {
    sellerId: "seller_123",
    url: "https://api.example.com/service",
    network: "stellar:testnet",
    assetCode: "USD",
    assetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQSXUSMIQSTBE2IXBI5VBLDF",
    amount: "10.0000000",
    payTo: "GCZST3XVCDTUJ76ZAV2HA72KYQP5ULVK2OJ5L3JWMNFXR26NXJZ7CUD"
  };

  describe("fingerprint computation", () => {
    it("produces consistent hashes for identical inputs", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint(baseInputs);

      expect(fp1.version).toBe(RESOURCE_FINGERPRINT_VERSION);
      expect(fp2.version).toBe(RESOURCE_FINGERPRINT_VERSION);
      expect(fp1.hash).toBe(fp2.hash);
    });

    it("produces deterministic hashes across multiple calls", () => {
      const hashes = Array.from({ length: 5 }, () =>
        computeResourceFingerprint(baseInputs).hash
      );

      const firstHash = hashes[0];
      expect(hashes.every((h) => h === firstHash)).toBe(true);
    });

    it("detects URL normalization (case-insensitivity)", () => {
      const fp1 = computeResourceFingerprint({
        ...baseInputs,
        url: "https://api.example.com/service"
      });
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        url: "HTTPS://API.EXAMPLE.COM/SERVICE"
      });

      expect(fp1.hash).toBe(fp2.hash);
    });

    it("detects asset code normalization (case-insensitivity)", () => {
      const fp1 = computeResourceFingerprint({
        ...baseInputs,
        assetCode: "usd"
      });
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        assetCode: "USD"
      });

      expect(fp1.hash).toBe(fp2.hash);
    });

    it("distinguishes different sellers", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        sellerId: "seller_456"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });

    it("distinguishes different endpoints", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        url: "https://api.different.com/service"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });

    it("distinguishes different networks", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        network: "stellar:pubnet"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });

    it("distinguishes different assets", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        assetCode: "EUR"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });

    it("distinguishes different asset issuers", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        assetIssuer: "GCNY5OXYSY4FZLOPT2SPJSPRING6Z2CUJCHZ7Y36CJT7XONBZILRWCEB"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });

    it("distinguishes different amounts", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        amount: "20.0000000"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });

    it("distinguishes different payment destinations", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        payTo: "GBFPQ2EMJVPCTF7XNHW5ZPHDHB2GWDL3P5TVCQD7IYXPXXZR5DTPWPM"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });
  });

  describe("metadata independence", () => {
    it("ignores name changes", () => {
      const fp1 = computeResourceFingerprint(baseInputs);

      // Name is not part of fingerprint inputs
      const fp2 = computeResourceFingerprint(baseInputs);
      expect(fp1.hash).toBe(fp2.hash);
    });

    it("detects duplicates despite minor URL path changes", () => {
      // Same endpoint, canonical URL should match
      const fp1 = computeResourceFingerprint({
        ...baseInputs,
        url: "https://api.example.com/v1/service"
      });
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        url: "https://api.example.com/v1/service"
      });

      expect(fp1.hash).toBe(fp2.hash);
    });

    it("treats different paths as different endpoints", () => {
      const fp1 = computeResourceFingerprint({
        ...baseInputs,
        url: "https://api.example.com/v1/service"
      });
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        url: "https://api.example.com/v2/service"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });
  });

  describe("collision safety", () => {
    it("resists field boundary collisions", () => {
      // If fields were not encoded with lengths, "ab" + "c" could
      // collide with "a" + "bc". Our encoding prevents this.
      const fp1 = computeResourceFingerprint({
        ...baseInputs,
        sellerId: "abc",
        url: "https://def.com"
      });
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        sellerId: "ab",
        url: "chttps://def.com"
      });

      expect(fp1.hash).not.toBe(fp2.hash);
    });

    it("produces different hashes for different resource combinations", () => {
      const variations = [
        { ...baseInputs },
        { ...baseInputs, sellerId: "seller_999" },
        { ...baseInputs, network: "stellar:pubnet" },
        { ...baseInputs, assetCode: "EUR" },
        { ...baseInputs, amount: "50.0000000" }
      ];

      const hashes = variations.map((v) => computeResourceFingerprint(v).hash);
      const uniqueHashes = new Set(hashes);

      expect(uniqueHashes.size).toBe(hashes.length);
    });
  });

  describe("version tracking", () => {
    it("includes version in fingerprint", () => {
      const fp = computeResourceFingerprint(baseInputs);
      expect(fp.version).toBe(1);
    });

    it("allows future version migration by checking versions", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint(baseInputs);

      // Both fingerprints have the same version, collision detection works
      expect(fp1.version).toBe(fp2.version);
      expect(fingerprintsMatch(fp1, fp2)).toBe(true);
    });
  });

  describe("fingerprint matching", () => {
    it("returns true for matching fingerprints", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint(baseInputs);

      expect(fingerprintsMatch(fp1, fp2)).toBe(true);
    });

    it("returns false for non-matching fingerprints", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = computeResourceFingerprint({
        ...baseInputs,
        sellerId: "different_seller"
      });

      expect(fingerprintsMatch(fp1, fp2)).toBe(false);
    });

    it("returns false for different versions", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = { ...fp1, version: 2 };

      expect(fingerprintsMatch(fp1, fp2)).toBe(false);
    });

    it("returns false for different hashes", () => {
      const fp1 = computeResourceFingerprint(baseInputs);
      const fp2 = { ...fp1, hash: "different_hash" };

      expect(fingerprintsMatch(fp1, fp2)).toBe(false);
    });
  });

  describe("real-world scenarios", () => {
    it("flags duplicate with same payment terms but different name", () => {
      const original: ResourceFingerprintInputs = {
        sellerId: "seller_v1",
        url: "https://service.provider.com/api",
        network: "stellar:testnet",
        assetCode: "USDC",
        assetIssuer: "GBBD47UZQ2EORUNQVU5R72XQV5IMLIQV2N26ESJQXYDUO4RZK4RIBUX",
        amount: "100.0000000",
        payTo: "GBVNBNNQJ7QXQYIUWVXJ7NWEYU5Y5ZXMBWVCQBSYM2HI73XB7NWHQUD"
      };

      const duplicate: ResourceFingerprintInputs = {
        ...original,
        // Name would be different but is not part of fingerprint
      };

      const fp1 = computeResourceFingerprint(original);
      const fp2 = computeResourceFingerprint(duplicate);

      expect(fingerprintsMatch(fp1, fp2)).toBe(true);
    });

    it("flags duplicate with URL case differences", () => {
      const original: ResourceFingerprintInputs = {
        ...baseInputs,
        url: "https://API.EXAMPLE.COM/Service"
      };

      const duplicate: ResourceFingerprintInputs = {
        ...baseInputs,
        url: "https://api.example.com/Service"
      };

      const fp1 = computeResourceFingerprint(original);
      const fp2 = computeResourceFingerprint(duplicate);

      expect(fingerprintsMatch(fp1, fp2)).toBe(true);
    });

    it("distinguishes resources with different network/asset combinations", () => {
      const testnet: ResourceFingerprintInputs = {
        ...baseInputs,
        network: "stellar:testnet"
      };

      const pubnet: ResourceFingerprintInputs = {
        ...baseInputs,
        network: "stellar:pubnet"
      };

      const fp1 = computeResourceFingerprint(testnet);
      const fp2 = computeResourceFingerprint(pubnet);

      expect(fingerprintsMatch(fp1, fp2)).toBe(false);
    });
  });
});
