import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { decodePaymentRequiredV2 } from "../packages/stellar-payments/src/index.js";

export type TestnetEndpointManifest = {
  environment: "testnet";
  status: "deployed" | "template";
  commits: {
    api: string;
    worker: string;
    mcp: string;
    paidResource: string;
  };
  migrationRunId: string;
  api: {
    baseUrl: string;
    health: string;
    metrics: string;
    readiness: string;
    supported: string;
    version: string;
  };
  mcp: {
    health: string;
    metrics: string;
    readiness: string;
    schema: string;
    version: string;
  };
  paidResource: {
    baseUrl: string;
    health: string;
    metrics: string;
    readiness: string;
    resourceId: string;
    resourceUrl: string;
    version: string;
  };
};

export type TestnetProbeEvidence = {
  checkedAt: string;
  commits: TestnetEndpointManifest["commits"];
  migrationRunId: string;
  officialV2Challenge: true;
  supportedExactTestnet: true;
};

export async function probeTestnetDeployment(
  manifest: TestnetEndpointManifest,
  fetchImpl: typeof fetch = fetch
): Promise<TestnetProbeEvidence> {
  const errors = validateTestnetEndpointManifest(manifest);
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const [apiHealth, apiReady, apiVersion, apiMetrics, supported] = await Promise.all([
    getJson(manifest.api.health, fetchImpl),
    getJson(manifest.api.readiness, fetchImpl),
    getJson(manifest.api.version, fetchImpl),
    getText(manifest.api.metrics, fetchImpl),
    getJson(manifest.api.supported, fetchImpl)
  ]);
  assertObjectMatch(apiHealth, { ok: true, app: "api" }, "API health");
  assertObjectMatch(apiReady, { ok: true }, "API readiness");
  assertCommit(apiVersion, manifest.commits.api, "API version");
  if (!apiMetrics.includes("lumenbazaar_api_uptime_seconds")) {
    throw new Error("API metrics did not expose the LumenBazaar registry.");
  }
  if (!hasExactTestnetCapability(supported)) {
    throw new Error("API did not advertise a deployed stellar:testnet exact capability.");
  }

  const [mcpHealth, mcpReady, mcpVersion, mcpMetrics, mcpSchema] = await Promise.all([
    getJson(manifest.mcp.health, fetchImpl),
    getJson(manifest.mcp.readiness, fetchImpl),
    getJson(manifest.mcp.version, fetchImpl),
    getText(manifest.mcp.metrics, fetchImpl),
    getJson(manifest.mcp.schema, fetchImpl)
  ]);
  assertObjectMatch(mcpHealth, { ok: true, app: "mcp-server" }, "MCP health");
  assertObjectMatch(mcpReady, { ok: true }, "MCP readiness");
  assertCommit(mcpVersion, manifest.commits.mcp, "MCP version");
  if (!mcpMetrics.includes("lumenbazaar_mcp_http_requests_total")) {
    throw new Error("MCP metrics did not expose the LumenBazaar registry.");
  }
  if (!hasTool(mcpSchema, "call_paid_resource")) {
    throw new Error("MCP schema did not advertise call_paid_resource after exact readiness.");
  }

  const [paidHealth, paidReady, paidVersion, paidMetrics] = await Promise.all([
    getJson(manifest.paidResource.health, fetchImpl),
    getJson(manifest.paidResource.readiness, fetchImpl),
    getJson(manifest.paidResource.version, fetchImpl),
    getText(manifest.paidResource.metrics, fetchImpl)
  ]);
  assertObjectMatch(paidHealth, { ok: true, app: "paid-weather-api" }, "paid resource health");
  assertObjectMatch(paidReady, { ok: true }, "paid resource readiness");
  assertCommit(paidVersion, manifest.commits.paidResource, "paid resource version");
  if (!paidMetrics.includes("lumenbazaar_weather_requests_total")) {
    throw new Error("Paid resource metrics did not expose the weather registry.");
  }

  const challengeResponse = await fetchWithTimeout(manifest.paidResource.resourceUrl, fetchImpl);
  if (challengeResponse.status !== 402) {
    throw new Error(`Paid resource returned HTTP ${challengeResponse.status} instead of 402.`);
  }
  const challengeHeader = challengeResponse.headers.get("payment-required");
  if (challengeHeader === null) throw new Error("Paid resource omitted PAYMENT-REQUIRED.");
  const challenge = decodePaymentRequiredV2(challengeHeader);
  if (
    challenge.x402Version !== 2 ||
    !challenge.accepts.some(
      (accept) => accept.scheme === "exact" && accept.network === "stellar:testnet"
    )
  ) {
    throw new Error("Paid resource did not return an official v2 Stellar exact challenge.");
  }

  return {
    checkedAt: new Date().toISOString(),
    commits: manifest.commits,
    migrationRunId: manifest.migrationRunId,
    officialV2Challenge: true,
    supportedExactTestnet: true
  };
}

export function validateTestnetEndpointManifest(manifest: TestnetEndpointManifest) {
  const errors: string[] = [];
  if (manifest.environment !== "testnet") errors.push("Manifest environment must be testnet.");
  if (manifest.status !== "deployed") errors.push("Manifest status must be deployed.");
  for (const [service, commit] of Object.entries(manifest.commits)) {
    if (!/^[a-f0-9]{40}$/u.test(commit)) errors.push(`${service} commit must be a full Git SHA.`);
  }
  if (isPlaceholder(manifest.migrationRunId)) {
    errors.push("migrationRunId must identify the recorded migration deployment.");
  }
  for (const [name, value] of endpointEntries(manifest)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || isPlaceholder(value)) {
        errors.push(`${name} must be a non-placeholder HTTPS URL.`);
      }
    } catch {
      errors.push(`${name} must be a valid URL.`);
    }
  }
  if (isPlaceholder(manifest.paidResource.resourceId)) {
    errors.push("paidResource.resourceId must be a deployed catalog resource ID.");
  }
  return errors;
}

async function getJson(url: string, fetchImpl: typeof fetch) {
  const response = await fetchWithTimeout(url, fetchImpl);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return (await response.json()) as unknown;
}

async function getText(url: string, fetchImpl: typeof fetch) {
  const response = await fetchWithTimeout(url, fetchImpl);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.text();
}

function fetchWithTimeout(url: string, fetchImpl: typeof fetch) {
  return fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
}

function assertObjectMatch(value: unknown, expected: Record<string, unknown>, label: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} returned a non-object response.`);
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if ((value as Record<string, unknown>)[key] !== expectedValue) {
      throw new Error(`${label} returned an unexpected ${key}.`);
    }
  }
}

function assertCommit(value: unknown, expected: string, label: string) {
  assertObjectMatch(value, { commit: expected }, label);
}

function hasExactTestnetCapability(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const kinds = (value as Record<string, unknown>).kinds;
  return (
    Array.isArray(kinds) &&
    kinds.some(
      (kind) =>
        typeof kind === "object" &&
        kind !== null &&
        (kind as Record<string, unknown>).scheme === "exact" &&
        (kind as Record<string, unknown>).network === "stellar:testnet"
    )
  );
}

function hasTool(value: unknown, name: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const tools = (value as Record<string, unknown>).tools;
  return (
    Array.isArray(tools) &&
    tools.some(
      (tool) =>
        typeof tool === "object" && tool !== null && (tool as Record<string, unknown>).name === name
    )
  );
}

function endpointEntries(manifest: TestnetEndpointManifest) {
  return [
    ["api.baseUrl", manifest.api.baseUrl],
    ["api.health", manifest.api.health],
    ["api.metrics", manifest.api.metrics],
    ["api.readiness", manifest.api.readiness],
    ["api.supported", manifest.api.supported],
    ["api.version", manifest.api.version],
    ["mcp.health", manifest.mcp.health],
    ["mcp.metrics", manifest.mcp.metrics],
    ["mcp.readiness", manifest.mcp.readiness],
    ["mcp.schema", manifest.mcp.schema],
    ["mcp.version", manifest.mcp.version],
    ["paidResource.baseUrl", manifest.paidResource.baseUrl],
    ["paidResource.health", manifest.paidResource.health],
    ["paidResource.metrics", manifest.paidResource.metrics],
    ["paidResource.readiness", manifest.paidResource.readiness],
    ["paidResource.resourceUrl", manifest.paidResource.resourceUrl],
    ["paidResource.version", manifest.paidResource.version]
  ] as Array<[string, string]>;
}

function isPlaceholder(value: string) {
  return value === "replace_me" || value.includes(".example");
}

async function main() {
  const manifestPath = argument("--manifest") ?? "docs/deployment/testnet-endpoints.json";
  const outputPath = argument("--output");
  const manifest = JSON.parse(
    await readFile(resolve(manifestPath), "utf8")
  ) as TestnetEndpointManifest;
  const evidence = await probeTestnetDeployment(manifest);
  if (outputPath !== undefined) {
    const target = resolve(outputPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(evidence, null, 2));
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (entrypoint === import.meta.url) {
  await main();
}
