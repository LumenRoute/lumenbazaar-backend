import { LumenError } from "./errors.js";
import { type JsonObject } from "./models.js";

const allowedTemplatePattern = /^\/[A-Za-z0-9._~\-/{}/]*$/;
const parameterPattern = /\{([^{}]+)\}/g;
const parameterNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function extractRouteTemplateParams(routeTemplate: string) {
  return [...routeTemplate.matchAll(parameterPattern)].map((match) => match[1] ?? "");
}

export function validateRouteTemplate(routeTemplate: string, inputSchema?: JsonObject) {
  if (!routeTemplate.startsWith("/")) {
    throw routeTemplateError("Route template must start with /.");
  }

  if (
    routeTemplate.includes("..") ||
    routeTemplate.includes("\\") ||
    routeTemplate.includes("//") ||
    !allowedTemplatePattern.test(routeTemplate)
  ) {
    throw routeTemplateError("Route template contains unsafe path syntax.");
  }

  if ((routeTemplate.match(/\{/g) ?? []).length !== (routeTemplate.match(/\}/g) ?? []).length) {
    throw routeTemplateError("Route template contains malformed parameters.");
  }

  const params = extractRouteTemplateParams(routeTemplate);
  const uniqueParams = new Set(params);

  if (uniqueParams.size !== params.length) {
    throw routeTemplateError("Route template contains duplicate parameters.");
  }

  for (const param of params) {
    if (!parameterNamePattern.test(param)) {
      throw routeTemplateError(`Route template parameter ${param} is invalid.`);
    }
  }

  validateParamsAgainstSchema(params, inputSchema);

  return {
    params
  };
}

function validateParamsAgainstSchema(params: string[], inputSchema: JsonObject | undefined) {
  if (inputSchema === undefined || params.length === 0) {
    return;
  }

  const properties = inputSchema.properties;

  if (!isRecord(properties)) {
    return;
  }

  for (const param of params) {
    if (!(param in properties)) {
      throw routeTemplateError(`Route parameter ${param} is missing from input schema.`);
    }
  }
}

function routeTemplateError(message: string) {
  return new LumenError("ROUTE_TEMPLATE_INVALID", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
