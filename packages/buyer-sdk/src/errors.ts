import { type LumenError } from "@lumenbazaar/shared";

export type ErrorCode =
  | "RESOURCE_NOT_FOUND"
  | "PAYMENT_REQUIRED"
  | "INVALID_PAYMENT"
  | "SETTLEMENT_FAILED"
  | "REPLAY_DETECTED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "BUDGET_EXCEEDED"
  | "INVALID_SCHEMA"
  | "UNKNOWN_ERROR";

export type MappedError = {
  code: ErrorCode;
  message: string;
  originalError?: Error;
  retryable: boolean;
};

/**
 * Map HTTP status codes to error codes
 */
export function mapHttpStatusToErrorCode(statusCode: number): ErrorCode {
  switch (statusCode) {
    case 400:
      return "INVALID_PAYMENT";
    case 402:
      return "PAYMENT_REQUIRED";
    case 404:
      return "RESOURCE_NOT_FOUND";
    case 409:
      return "REPLAY_DETECTED";
    case 429:
      return "NETWORK_ERROR"; // Rate limit
    case 500:
    case 502:
    case 503:
      return "SETTLEMENT_FAILED";
    default:
      return "UNKNOWN_ERROR";
  }
}

/**
 * Map error response to standardized error
 */
export function mapResponseError(response: Response, body?: unknown): MappedError {
  const code = mapHttpStatusToErrorCode(response.status);
  const message = extractErrorMessage(body, response.statusText);

  return {
    code,
    message,
    retryable: isRetryable(response.status)
  };
}

/**
 * Map caught exception to standardized error
 */
export function mapCaughtError(error: unknown): MappedError {
  if (error instanceof Error) {
    let code: ErrorCode = "UNKNOWN_ERROR";
    let retryable = false;

    if (error.message.includes("timeout")) {
      code = "TIMEOUT";
      retryable = true;
    } else if (error.message.includes("network")) {
      code = "NETWORK_ERROR";
      retryable = true;
    } else if (error.message.includes("budget")) {
      code = "BUDGET_EXCEEDED";
      retryable = false;
    } else if (error.message.includes("schema")) {
      code = "INVALID_SCHEMA";
      retryable = false;
    }

    return {
      code,
      message: error.message,
      originalError: error,
      retryable
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(error),
    retryable: false
  };
}

/**
 * Map LumenError from API to standardized error
 */
export function mapLumenError(lumenError: LumenError | unknown): MappedError {
  if (lumenError && typeof lumenError === "object" && "code" in lumenError) {
    const err = lumenError as Record<string, unknown>;
    const apiCode = String(err.code);
    const code = mapApiErrorCode(apiCode);
    const message = String(err.message || "Unknown error");

    return {
      code,
      message,
      retryable: isApiErrorRetryable(apiCode)
    };
  }

  return mapCaughtError(lumenError);
}

/**
 * Map API error codes to buyer SDK error codes
 */
function mapApiErrorCode(apiCode: string): ErrorCode {
  const codeMap: Record<string, ErrorCode> = {
    RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
    INVALID_PAYMENT_PAYLOAD: "INVALID_PAYMENT",
    SETTLEMENT_FAILED: "SETTLEMENT_FAILED",
    REPLAY_DETECTED: "REPLAY_DETECTED",
    UNSUPPORTED_NETWORK: "INVALID_PAYMENT",
    UNSUPPORTED_ASSET: "INVALID_PAYMENT"
  };

  return codeMap[apiCode] || "UNKNOWN_ERROR";
}

/**
 * Check if an API error code is retryable
 */
function isApiErrorRetryable(apiCode: string): boolean {
  const nonRetryable = [
    "INVALID_PAYMENT_PAYLOAD",
    "REPLAY_DETECTED",
    "RESOURCE_NOT_FOUND",
    "UNSUPPORTED_NETWORK",
    "UNSUPPORTED_ASSET"
  ];

  return !nonRetryable.includes(apiCode);
}

/**
 * Check if an HTTP status is retryable
 */
function isRetryable(statusCode: number): boolean {
  // Retry on server errors (5xx) and specific client errors
  return statusCode >= 500 || [408, 429].includes(statusCode);
}

/**
 * Extract error message from response body
 */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const bodyObj = body as Record<string, unknown>;

  if (typeof bodyObj.message === "string") {
    return bodyObj.message;
  }

  if (typeof bodyObj.error === "string") {
    return bodyObj.error;
  }

  if (typeof bodyObj.reason === "string") {
    return bodyObj.reason;
  }

  return fallback;
}
