import { describe, expect, it } from "vitest";

import { AuditLogService, sanitizeAuditMetadata } from "./audit.js";

describe("AuditLogService", () => {
  it("redacts sensitive metadata before storing audit records", async () => {
    const service = new AuditLogService();

    await service.record({
      action: "payment.verify",
      actorType: "facilitator",
      targetType: "payment_attempt",
      metadata: {
        amount: "0.05",
        authorization: {
          signature: "secret-signature"
        },
        nested: {
          apiKey: "secret-key",
          network: "stellar:testnet"
        }
      }
    });

    await expect(service.list()).resolves.toMatchObject([
      {
        metadata: {
          amount: "0.05",
          authorization: "[redacted]",
          nested: {
            apiKey: "[redacted]",
            network: "stellar:testnet"
          }
        }
      }
    ]);
  });

  it("sanitizes non-json metadata values", () => {
    expect(
      sanitizeAuditMetadata({
        callback: () => "unused",
        token: "secret"
      })
    ).toEqual({
      callback: expect.stringContaining("=>"),
      token: "[redacted]"
    });
  });
});
