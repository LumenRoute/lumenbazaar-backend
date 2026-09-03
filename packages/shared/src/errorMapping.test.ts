import { describe, expect, it } from "vitest";

import {
  LumenError,
  documentedErrorStatuses,
  errorCodes,
  mapInfrastructureError,
  redactSensitiveDetails,
  toPublicError
} from "./index.js";

describe("stable error code system", () => {
  it("assigns a status code to every documented error code", () => {
    expect(documentedErrorStatuses()).toHaveLength(errorCodes.length);
    expect(documentedErrorStatuses().every((entry) => entry.statusCode >= 400)).toBe(true);
  });

  it("redacts sensitive details before returning public errors", () => {
    expect(
      toPublicError(
        new LumenError("INVALID_PAYMENT_PAYLOAD", "Invalid payload.", {
          details: {
            signature: "raw-signature",
            nested: {
              apiKey: "secret"
            },
            field: "amount"
          }
        })
      )
    ).toEqual({
      code: "INVALID_PAYMENT_PAYLOAD",
      message: "Invalid payload.",
      details: {
        signature: "[redacted]",
        nested: {
          apiKey: "[redacted]"
        },
        field: "amount"
      }
    });
  });

  it("maps Prisma payment hash uniqueness to replay detection", () => {
    expect(
      mapInfrastructureError({
        code: "P2002",
        meta: {
          target: ["paymentHash"]
        }
      })
    ).toMatchObject({
      code: "REPLAY_DETECTED"
    });
  });

  it("redacts details recursively", () => {
    expect(
      redactSensitiveDetails({
        token: "secret-token",
        ok: ["value", { password: "secret-password" }]
      })
    ).toEqual({
      token: "[redacted]",
      ok: ["value", { password: "[redacted]" }]
    });
  });
});
