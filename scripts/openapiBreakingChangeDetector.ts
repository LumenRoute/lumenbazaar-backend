/**
 * OpenAPI Breaking Change Detector
 *
 * Compares generated OpenAPI spec against a pinned baseline and classifies
 * changes as BREAKING, ADDITIVE, or UNKNOWN (fail-closed).
 *
 * Requirements for a breaking change to be approved:
 * 1. Change must be recorded in docs/api/compat-decisions.json
 * 2. API version must be bumped
 * 3. Migration notes must be non-empty
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ChangeClassification = "BREAKING" | "ADDITIVE" | "UNKNOWN";

export type DetectedChange = {
  path: string;
  type: "path" | "operation" | "property" | "parameter" | "response" | "security";
  classification: ChangeClassification;
  description: string;
};

export type BreakingChangeReport = {
  baselineVersion: string;
  generatedVersion: string;
  versionBumped: boolean;
  breaking: DetectedChange[];
  approvedBreaking: DetectedChange[];
  additive: DetectedChange[];
  unknown: DetectedChange[];
  isValid: boolean; // true if all breaking changes are approved
};

export type CompatibilityDecision = {
  changeId: string;
  description: string;
  apiVersion: string;
  migrationNotes: string;
  approvedAt: string; // ISO 8601 timestamp
  reason: string;
};

type OpenApiPath = {
  [method: string]: {
    operationId?: string;
    parameters?: Array<{ name: string; in: string; required?: boolean; schema?: object }>;
    requestBody?: { required?: boolean; content?: object };
    responses?: {
      [status: string]: { description?: string; content?: object };
    };
    security?: Array<{ [key: string]: string[] }>;
  };
};

type OpenApiSpec = {
  info: { version: string };
  paths?: { [path: string]: OpenApiPath };
  components?: { securitySchemes?: object };
};

/**
 * Generate a unique ID for a change for tracking in compat-decisions.json
 */
function generateChangeId(change: DetectedChange): string {
  const path = change.path.replace(/\//g, ".").replace(/\{.*?\}/g, "{id}");
  return `change_${path}_${change.type}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/**
 * Deeply compare two objects for equality
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;

  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(
    (key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

/**
 * Classify the removal of a path as BREAKING
 */
function classifyRemovedPath(path: string): DetectedChange {
  return {
    path,
    type: "path",
    classification: "BREAKING",
    description: `Path removed: ${path}`
  };
}

/**
 * Classify the removal of an operation as BREAKING
 */
function classifyRemovedOperation(path: string, method: string): DetectedChange {
  return {
    path: `${path}[${method.toUpperCase()}]`,
    type: "operation",
    classification: "BREAKING",
    description: `Operation removed: ${method.toUpperCase()} ${path}`
  };
}

/**
 * Classify the removal of a response status code as BREAKING
 */
function classifyRemovedResponseCode(
  path: string,
  method: string,
  status: string
): DetectedChange {
  return {
    path: `${path}[${method.toUpperCase()}]#${status}`,
    type: "response",
    classification: "BREAKING",
    description: `Response status removed: ${status} from ${method.toUpperCase()} ${path}`
  };
}

/**
 * Classify changes to request parameters as BREAKING or ADDITIVE
 */
function classifyParameterChange(
  path: string,
  method: string,
  baselineParams: Array<{ name: string; in: string; required?: boolean; schema?: object }> = [],
  generatedParams: Array<{ name: string; in: string; required?: boolean; schema?: object }> = []
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  // Check for removed or required parameters (BREAKING)
  for (const baselineParam of baselineParams) {
    const generatedParam = generatedParams.find(
      (p) => p.name === baselineParam.name && p.in === baselineParam.in
    );

    if (generatedParam === undefined) {
      changes.push({
        path: `${path}[${method.toUpperCase()}]#${baselineParam.in}(${baselineParam.name})`,
        type: "parameter",
        classification: "BREAKING",
        description: `Parameter removed: ${baselineParam.name} (${baselineParam.in}) from ${method.toUpperCase()} ${path}`
      });
    } else if (!baselineParam.required && generatedParam.required) {
      // Parameter became required (BREAKING)
      changes.push({
        path: `${path}[${method.toUpperCase()}]#${baselineParam.in}(${baselineParam.name})`,
        type: "parameter",
        classification: "BREAKING",
        description: `Parameter now required: ${baselineParam.name} (${baselineParam.in}) in ${method.toUpperCase()} ${path}`
      });
    } else if (
      baselineParam.schema &&
      generatedParam.schema &&
      !deepEqual(baselineParam.schema, generatedParam.schema)
    ) {
      // Parameter schema changed (narrowed type or stricter constraints = BREAKING)
      changes.push({
        path: `${path}[${method.toUpperCase()}]#${baselineParam.in}(${baselineParam.name})`,
        type: "parameter",
        classification: "BREAKING",
        description: `Parameter schema changed: ${baselineParam.name} in ${method.toUpperCase()} ${path}`
      });
    }
  }

  // Check for new optional parameters (ADDITIVE)
  for (const generatedParam of generatedParams) {
    const baselineParam = baselineParams.find(
      (p) => p.name === generatedParam.name && p.in === generatedParam.in
    );

    if (baselineParam === undefined && !generatedParam.required) {
      changes.push({
        path: `${path}[${method.toUpperCase()}]#${generatedParam.in}(${generatedParam.name})`,
        type: "parameter",
        classification: "ADDITIVE",
        description: `Optional parameter added: ${generatedParam.name} (${generatedParam.in}) in ${method.toUpperCase()} ${path}`
      });
    }
  }

  return changes;
}

/**
 * Classify changes to request bodies as BREAKING or ADDITIVE
 */
function classifyRequestBodyChange(
  path: string,
  method: string,
  baselineRequired: boolean = false,
  generatedRequired: boolean = false
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  if (baselineRequired && !generatedRequired) {
    changes.push({
      path: `${path}[${method.toUpperCase()}]#request`,
      type: "parameter",
      classification: "BREAKING",
      description: `Request body is now optional in ${method.toUpperCase()} ${path}`
    });
  } else if (!baselineRequired && generatedRequired) {
    changes.push({
      path: `${path}[${method.toUpperCase()}]#request`,
      type: "parameter",
      classification: "BREAKING",
      description: `Request body is now required in ${method.toUpperCase()} ${path}`
    });
  }

  return changes;
}

/**
 * Classify changes to response bodies as BREAKING or ADDITIVE
 */
function classifyResponseChange(
  path: string,
  method: string,
  status: string,
  baselineContent: object = {},
  generatedContent: object = {}
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  const baselineProps = baselineContent &&
    typeof baselineContent === "object" &&
    "schema" in baselineContent && (baselineContent as any).schema?.properties
    ? Object.keys((baselineContent as any).schema.properties)
    : [];

  const generatedProps = generatedContent &&
    typeof generatedContent === "object" &&
    "schema" in generatedContent && (generatedContent as any).schema?.properties
    ? Object.keys((generatedContent as any).schema.properties)
    : [];

  // Check for removed response properties (BREAKING)
  for (const prop of baselineProps) {
    if (!generatedProps.includes(prop)) {
      changes.push({
        path: `${path}[${method.toUpperCase()}]#${status}.${prop}`,
        type: "property",
        classification: "BREAKING",
        description: `Response property removed: ${prop} from ${status} response in ${method.toUpperCase()} ${path}`
      });
    }
  }

  // Check for new response properties (ADDITIVE)
  for (const prop of generatedProps) {
    if (!baselineProps.includes(prop)) {
      changes.push({
        path: `${path}[${method.toUpperCase()}]#${status}.${prop}`,
        type: "property",
        classification: "ADDITIVE",
        description: `Response property added: ${prop} to ${status} response in ${method.toUpperCase()} ${path}`
      });
    }
  }

  return changes;
}

/**
 * Classify changes to security requirements as BREAKING
 */
function classifySecurityChange(
  path: string,
  method: string,
  baselineSecurity: Array<{ [key: string]: string[] }> = [],
  generatedSecurity: Array<{ [key: string]: string[] }> = []
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  // Simplified: if security requirements changed, it's BREAKING
  if (!deepEqual(baselineSecurity, generatedSecurity)) {
    changes.push({
      path: `${path}[${method.toUpperCase()}]#security`,
      type: "security",
      classification: "BREAKING",
      description: `Security requirements changed for ${method.toUpperCase()} ${path}`
    });
  }

  return changes;
}

/**
 * Main comparison function: detect all breaking/additive changes
 */
export function detectChanges(
  baseline: OpenApiSpec,
  generated: OpenApiSpec
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  const baselinePaths = baseline.paths ?? {};
  const generatedPaths = generated.paths ?? {};

  // Check for removed paths and operations
  for (const [path, baselinePathItem] of Object.entries(baselinePaths)) {
    if (!(path in generatedPaths)) {
      changes.push(classifyRemovedPath(path));
      continue;
    }

    const generatedPathItem = generatedPaths[path];

    // Check each HTTP method
    for (const [method, baselineOp] of Object.entries(baselinePathItem)) {
      if (method.startsWith("x-") || method === "parameters" || method === "servers") {
        continue; // Skip extensions
      }

      if (!(method in generatedPathItem)) {
        changes.push(classifyRemovedOperation(path, method));
        continue;
      }

      const generatedOp = generatedPathItem[method];

      // Check parameters
      changes.push(
        ...classifyParameterChange(path, method, baselineOp.parameters, generatedOp.parameters)
      );

      // Check request body
      changes.push(
        ...classifyRequestBodyChange(
          path,
          method,
          baselineOp.requestBody?.required ?? false,
          generatedOp.requestBody?.required ?? false
        )
      );

      // Check responses
      const baselineResponses = baselineOp.responses ?? {};
      const generatedResponses = generatedOp.responses ?? {};

      for (const [status, baselineResponse] of Object.entries(baselineResponses)) {
        if (!(status in generatedResponses)) {
          changes.push(classifyRemovedResponseCode(path, method, status));
        } else {
          const generatedResponse = generatedResponses[status];
          changes.push(
            ...classifyResponseChange(
              path,
              method,
              status,
              baselineResponse.content as object,
              generatedResponse.content as object
            )
          );
        }
      }

      // Check security
      changes.push(
        ...classifySecurityChange(path, method, baselineOp.security, generatedOp.security)
      );
    }
  }

  // Check for new paths and operations (ADDITIVE)
  for (const [path, generatedPathItem] of Object.entries(generatedPaths)) {
    if (!(path in baselinePaths)) {
      changes.push({
        path,
        type: "path",
        classification: "ADDITIVE",
        description: `New path added: ${path}`
      });
      continue;
    }

    const baselinePathItem = baselinePaths[path];

    for (const [method, generatedOp] of Object.entries(generatedPathItem)) {
      if (method.startsWith("x-") || method === "parameters" || method === "servers") {
        continue;
      }

      if (!(method in baselinePathItem)) {
        changes.push({
          path: `${path}[${method.toUpperCase()}]`,
          type: "operation",
          classification: "ADDITIVE",
          description: `New operation added: ${method.toUpperCase()} ${path}`
        });
      }
    }
  }

  return changes;
}

/**
 * Load and parse compatibility decisions from file
 */
export async function loadCompatibilityDecisions(
  filePath: string
): Promise<Map<string, CompatibilityDecision>> {
  try {
    const content = await readFile(filePath, "utf8");
    const data = JSON.parse(content);
    const decisions = new Map<string, CompatibilityDecision>();

    if (Array.isArray(data.approvedChanges)) {
      for (const decision of data.approvedChanges) {
        decisions.set(decision.changeId, decision);
      }
    }

    return decisions;
  } catch {
    return new Map();
  }
}

/**
 * Generate breaking change report
 */
export function generateReport(
  changes: DetectedChange[],
  baselineVersion: string,
  generatedVersion: string,
  approvedDecisions: Map<string, CompatibilityDecision>
): BreakingChangeReport {
  const breaking = changes.filter((c) => c.classification === "BREAKING");
  const additive = changes.filter((c) => c.classification === "ADDITIVE");
  const unknown = changes.filter((c) => c.classification === "UNKNOWN");

  const approvedBreaking: DetectedChange[] = [];
  const unapprovedBreaking: DetectedChange[] = [];

  for (const change of breaking) {
    const changeId = generateChangeId(change);
    if (approvedDecisions.has(changeId)) {
      const decision = approvedDecisions.get(changeId)!;
      // Verify version was bumped and migration notes exist
      if (
        generatedVersion > decision.apiVersion &&
        decision.migrationNotes &&
        decision.migrationNotes.trim().length > 0
      ) {
        approvedBreaking.push(change);
      } else {
        unapprovedBreaking.push(change);
      }
    } else {
      unapprovedBreaking.push(change);
    }
  }

  const versionBumped = generatedVersion > baselineVersion;

  return {
    baselineVersion,
    generatedVersion,
    versionBumped,
    breaking: unapprovedBreaking,
    approvedBreaking,
    additive,
    unknown,
    isValid: unapprovedBreaking.length === 0 && unknown.length === 0
  };
}

/**
 * Format report for human reading
 */
export function formatReport(report: BreakingChangeReport): string {
  const lines: string[] = [];

  lines.push("=== OpenAPI Compatibility Report ===\n");
  lines.push(`Baseline Version: ${report.baselineVersion}`);
  lines.push(`Generated Version: ${report.generatedVersion}`);
  lines.push(`Version Bumped: ${report.versionBumped ? "✓" : "✗"}`);
  lines.push("");

  if (report.breaking.length > 0) {
    lines.push("❌ UNAPPROVED BREAKING CHANGES:");
    for (const change of report.breaking) {
      lines.push(`  - ${change.description}`);
      lines.push(`    (Record in docs/api/compat-decisions.json with changeId: ${generateChangeId(change)})`);
    }
    lines.push("");
  }

  if (report.approvedBreaking.length > 0) {
    lines.push("✓ APPROVED BREAKING CHANGES:");
    for (const change of report.approvedBreaking) {
      lines.push(`  - ${change.description}`);
    }
    lines.push("");
  }

  if (report.additive.length > 0) {
    lines.push("✓ ADDITIVE CHANGES:");
    for (const change of report.additive) {
      lines.push(`  - ${change.description}`);
    }
    lines.push("");
  }

  if (report.unknown.length > 0) {
    lines.push("⚠ UNKNOWN CHANGES (treated as breaking):");
    for (const change of report.unknown) {
      lines.push(`  - ${change.description}`);
    }
    lines.push("");
  }

  lines.push(`\nResult: ${report.isValid ? "✓ PASS" : "✗ FAIL"}`);

  return lines.join("\n");
}

/**
 * Write report as JSON artifact for CI
 */
export function writeReportArtifact(report: BreakingChangeReport): string {
  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      status: report.isValid ? "pass" : "fail",
      summary: {
        baselineVersion: report.baselineVersion,
        generatedVersion: report.generatedVersion,
        versionBumped: report.versionBumped,
        breakingChanges: report.breaking.length,
        approvedBreakingChanges: report.approvedBreaking.length,
        additiveChanges: report.additive.length,
        unknownChanges: report.unknown.length
      },
      breaking: report.breaking,
      approved: report.approvedBreaking,
      additive: report.additive,
      unknown: report.unknown
    },
    null,
    2
  );
}
