import { type ApiErrorBody } from "./api.js";
import { type ErrorCode, LumenError, defaultErrorStatus, errorCodes } from "./errors.js";

const sensitiveKeyPattern =
  /(secret|seed|private|token|signature|authorization|password|api[_-]?key)/i;

export function toPublicError(error: LumenError): ApiErrorBody {
  return {
    code: error.code,
    message: error.message,
    ...(error.details === undefined ? {} : { details: redactSensitiveDetails(error.details) })
  };
}

export function mapInfrastructureError(error: unknown): LumenError {
  if (error instanceof LumenError) {
    return error;
  }

  if (isPrismaUniqueConstraintError(error)) {
    const target = getPrismaTarget(error);
    const code: ErrorCode = target.includes("paymentHash")
      ? "REPLAY_DETECTED"
      : "VALIDATION_FAILED";

    return new LumenError(code, "Unique constraint rejected the request.");
  }

  return new LumenError("INTERNAL_ERROR", "Internal server error.");
}

export function redactSensitiveDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : redactNestedValue(value)
    ])
  );
}

export function documentedErrorStatuses() {
  return errorCodes.map((code) => ({
    code,
    statusCode: defaultErrorStatus[code]
  }));
}

function redactNestedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactNestedValue(item));
  }

  if (value !== null && typeof value === "object") {
    return redactSensitiveDetails(value as Record<string, unknown>);
  }

  return value;
}

function isPrismaUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

function getPrismaTarget(error: unknown) {
  const meta = (error as { meta?: { target?: unknown } }).meta;

  return Array.isArray(meta?.target)
    ? meta.target.filter((value): value is string => typeof value === "string")
    : [];
}
