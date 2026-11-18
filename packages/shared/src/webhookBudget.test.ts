import { describe, it, expect } from "vitest";
import {
  serializeWebhookPayload,
  WEBHOOK_MAX_PAYLOAD_BYTES,
  WebhookPayloadTooLarge,
  type WebhookPayload
} from "./webhooks.js";

describe("webhook serialized byte budget", () => {
  it("accepts exact boundary and rejects one byte beyond without truncation", () => {
    const base = { failureReason: "" } as WebhookPayload;
    const overhead = Buffer.byteLength(JSON.stringify(base));
    const payload = { ...base, failureReason: "a".repeat(WEBHOOK_MAX_PAYLOAD_BYTES - overhead) };
    expect(Buffer.byteLength(serializeWebhookPayload(payload))).toBe(WEBHOOK_MAX_PAYLOAD_BYTES);
    expect(() =>
      serializeWebhookPayload({ ...payload, failureReason: payload.failureReason + "a" })
    ).toThrow(WebhookPayloadTooLarge);
    expect(payload.failureReason.length).toBe(WEBHOOK_MAX_PAYLOAD_BYTES - overhead);
  });
  it("measures multibyte and JSON-escaped values as transmitted", () => {
    const payload = { failureReason: '😀"\n'.repeat(3000) } as WebhookPayload;
    expect(() => serializeWebhookPayload(payload)).toThrow(WebhookPayloadTooLarge);
  });
});
