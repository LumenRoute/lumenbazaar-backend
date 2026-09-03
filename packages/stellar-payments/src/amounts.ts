import { LumenError } from "@lumenbazaar/shared";

const exactAmountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;

export function normalizeExactAmount(amount: string) {
  const trimmed = amount.trim();

  if (!exactAmountPattern.test(trimmed)) {
    throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Amount must be a positive decimal string.");
  }

  const stroops = amountToStroops(trimmed);

  if (stroops <= 0n) {
    throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Amount must be greater than zero.");
  }

  const normalizedWhole = stroops / 10_000_000n;
  const normalizedFraction = (stroops % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");

  return normalizedFraction.length === 0
    ? normalizedWhole.toString()
    : `${normalizedWhole.toString()}.${normalizedFraction}`;
}

export function amountsEqual(left: string, right: string) {
  return normalizeExactAmount(left) === normalizeExactAmount(right);
}

export function amountToStroops(amount: string) {
  const trimmed = amount.trim();

  if (!exactAmountPattern.test(trimmed)) {
    throw new LumenError("INVALID_PAYMENT_PAYLOAD", "Amount must be a positive decimal string.");
  }

  const [wholePart = "0", decimalPart = ""] = trimmed.split(".");
  return BigInt(wholePart) * 10_000_000n + BigInt(decimalPart.padEnd(7, "0"));
}

export function compareExactAmounts(left: string, right: string) {
  const leftUnits = amountToStroops(left);
  const rightUnits = amountToStroops(right);

  if (leftUnits === rightUnits) {
    return 0;
  }

  return leftUnits > rightUnits ? 1 : -1;
}
