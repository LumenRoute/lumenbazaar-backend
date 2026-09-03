import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${canonicalJson(nestedValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function computePaymentHash(paymentPayload: unknown) {
  return createHash("sha256").update(canonicalJson(paymentPayload)).digest("hex");
}
