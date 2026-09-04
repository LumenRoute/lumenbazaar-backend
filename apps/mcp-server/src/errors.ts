/**
 * Structured MCP error types and utilities
 */

export class McpError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "McpError";
  }

  toMcpError() {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

export class ValidationError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INVALID_ARGUMENT", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("RESOURCE_NOT_FOUND", message, details);
    this.name = "NotFoundError";
  }
}

export class BackendError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INTERNAL_ERROR", message, details);
    this.name = "BackendError";
  }
}

export class PermissionError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PERMISSION_DENIED", message, details);
    this.name = "PermissionError";
  }
}

/**
 * Map errors to structured MCP responses
 */
export function handleToolError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (error instanceof McpError) {
    const result: { code: string; message: string; details?: Record<string, unknown> } = {
      code: error.code,
      message: error.message
    };
    if (error.details !== undefined) {
      result.details = error.details;
    }
    return result;
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred"
  };
}
