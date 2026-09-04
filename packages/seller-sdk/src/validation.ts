import { type JsonObject } from "@lumenbazaar/shared";

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validate a route template for security and correctness
 * Prevents path traversal and malformed templates
 */
export function validateRouteTemplate(template: string): ValidationResult {
  const errors: string[] = [];

  // Check if template is empty
  if (!template || template.trim().length === 0) {
    errors.push("Route template cannot be empty");
    return { valid: false, errors };
  }

  // Must start with /
  if (!template.startsWith("/")) {
    errors.push("Route template must start with /");
  }

  // Check for path traversal attempts
  if (template.includes("..")) {
    errors.push("Route template cannot contain .. (path traversal)");
  }

  // Check for invalid characters
  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>:|?*\u0000-\u001f]/u;
  if (invalidChars.test(template)) {
    errors.push("Route template contains invalid characters");
  }

  // Check for valid parameter syntax
  const paramRegex = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g;
  const params = template.match(paramRegex) || [];

  // Extract parameter names
  const paramNames = params.map((p) => p.slice(1, -1));

  // Check for duplicate parameters
  const duplicates = paramNames.filter((p, i) => paramNames.indexOf(p) !== i);
  if (duplicates.length > 0) {
    errors.push(`Route template has duplicate parameters: ${[...new Set(duplicates)].join(", ")}`);
  }

  // Validate parameter names (no special characters)
  for (const paramName of paramNames) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName)) {
      errors.push(`Invalid parameter name: ${paramName}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate a JSON Schema
 * Basic checks for schema correctness
 */
export function validateJsonSchema(schema: JsonObject): ValidationResult {
  const errors: string[] = [];

  // Check if schema is an object
  if (!schema || typeof schema !== "object") {
    errors.push("Schema must be a JSON object");
    return { valid: false, errors };
  }

  // If type is specified, check it
  const type = schema.type;
  if (
    type !== undefined &&
    !["object", "array", "string", "number", "integer", "boolean", "null"].includes(String(type))
  ) {
    errors.push(`Invalid schema type: ${type}`);
  }

  // If properties specified, check they're an object
  if (schema.properties !== undefined && typeof schema.properties !== "object") {
    errors.push("Schema properties must be an object");
  }

  // If required specified, check it's an array
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    errors.push("Schema required must be an array");
  }

  // Validate required array contains strings
  if (Array.isArray(schema.required)) {
    for (const req of schema.required) {
      if (typeof req !== "string") {
        errors.push("Schema required array must contain strings");
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate input and output schemas together
 */
export function validateSchemaPair(
  inputSchema: JsonObject,
  outputSchema: JsonObject
): ValidationResult {
  const errors: string[] = [];

  const inputValidation = validateJsonSchema(inputSchema);
  if (!inputValidation.valid) {
    errors.push(`Input schema: ${inputValidation.errors.join("; ")}`);
  }

  const outputValidation = validateJsonSchema(outputSchema);
  if (!outputValidation.valid) {
    errors.push(`Output schema: ${outputValidation.errors.join("; ")}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate MCP tool metadata
 */
export function validateMcpToolMetadata(metadata: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (!metadata || typeof metadata !== "object") {
    errors.push("MCP tool metadata must be an object");
    return { valid: false, errors };
  }

  // Check name
  if (!metadata.name || typeof metadata.name !== "string") {
    errors.push("MCP tool must have a name (string)");
  }

  // Check description
  if (!metadata.description || typeof metadata.description !== "string") {
    errors.push("MCP tool must have a description (string)");
  }

  // Check input schema
  if (!metadata.inputSchema || typeof metadata.inputSchema !== "object") {
    errors.push("MCP tool must have inputSchema (object)");
  } else {
    const schemaValidation = validateJsonSchema(metadata.inputSchema as JsonObject);
    if (!schemaValidation.valid) {
      errors.push(`MCP tool inputSchema: ${schemaValidation.errors.join("; ")}`);
    }
  }

  // Check output schema
  if (!metadata.outputSchema || typeof metadata.outputSchema !== "object") {
    errors.push("MCP tool must have outputSchema (object)");
  } else {
    const schemaValidation = validateJsonSchema(metadata.outputSchema as JsonObject);
    if (!schemaValidation.valid) {
      errors.push(`MCP tool outputSchema: ${schemaValidation.errors.join("; ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate HTTP endpoint metadata
 */
export function validateHttpEndpointMetadata(metadata: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (!metadata || typeof metadata !== "object") {
    errors.push("HTTP endpoint metadata must be an object");
    return { valid: false, errors };
  }

  // Check name
  if (!metadata.name || typeof metadata.name !== "string") {
    errors.push("HTTP endpoint must have a name (string)");
  }

  // Check description
  if (!metadata.description || typeof metadata.description !== "string") {
    errors.push("HTTP endpoint must have a description (string)");
  }

  // Check URL
  if (!metadata.url || typeof metadata.url !== "string") {
    errors.push("HTTP endpoint must have a url (string)");
  }

  // Check route template
  if (!metadata.routeTemplate || typeof metadata.routeTemplate !== "string") {
    errors.push("HTTP endpoint must have a routeTemplate (string)");
  } else {
    const templateValidation = validateRouteTemplate(metadata.routeTemplate);
    if (!templateValidation.valid) {
      errors.push(`HTTP endpoint routeTemplate: ${templateValidation.errors.join("; ")}`);
    }
  }

  // Check input schema
  if (!metadata.inputSchema || typeof metadata.inputSchema !== "object") {
    errors.push("HTTP endpoint must have inputSchema (object)");
  } else {
    const schemaValidation = validateJsonSchema(metadata.inputSchema as JsonObject);
    if (!schemaValidation.valid) {
      errors.push(`HTTP endpoint inputSchema: ${schemaValidation.errors.join("; ")}`);
    }
  }

  // Check output schema
  if (!metadata.outputSchema || typeof metadata.outputSchema !== "object") {
    errors.push("HTTP endpoint must have outputSchema (object)");
  } else {
    const schemaValidation = validateJsonSchema(metadata.outputSchema as JsonObject);
    if (!schemaValidation.valid) {
      errors.push(`HTTP endpoint outputSchema: ${schemaValidation.errors.join("; ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Match route template parameters to schema properties
 */
export function matchRouteParamsToSchema(
  routeTemplate: string,
  inputSchema: JsonObject
): ValidationResult {
  const errors: string[] = [];

  // Extract parameter names from route template
  const paramRegex = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  const matches = [...routeTemplate.matchAll(paramRegex)];
  const routeParams = matches.map((m) => m[1]);

  // Get schema properties
  const schemaProperties = inputSchema.properties;
  if (!schemaProperties || typeof schemaProperties !== "object") {
    errors.push("Input schema must have properties object for parameter matching");
    return { valid: false, errors };
  }

  const schemaProps = Object.keys(schemaProperties);

  // Check each route parameter has a matching schema property
  for (const param of routeParams) {
    if (param && !schemaProps.includes(param)) {
      errors.push(`Route parameter '{${param}}' not found in schema properties`);
    }
  }

  // Warn about schema properties that aren't route parameters (they'd be in query/body)
  // This is informational, not an error

  return {
    valid: errors.length === 0,
    errors
  };
}
