import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { InMemoryWorkerBackend, createWorkerApp } from "../apps/worker/src/worker.js";
import { queueNames } from "../apps/worker/src/queues.js";
import { localIssuerPublicKey, type NetworkId } from "../packages/shared/src/networks.js";

export const loadTargets = ["verify", "settle", "search", "worker"] as const;

export type LoadTarget = (typeof loadTargets)[number];

export type LoadTestOptions = {
  baseUrl: string;
  concurrency: number;
  environment: string;
  outputPath?: string;
  requests: number;
  searchQuery: string;
  settleTemplatePath?: string;
  targets: LoadTarget[];
  verifyTemplatePath?: string;
};

export type LoadSample = {
  durationMs: number;
  error?: string;
  ok: boolean;
  statusCode?: number;
};

export type LatencySummary = {
  avg: number;
  max: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
};

export type LoadScenarioResult = {
  completedAt: string;
  concurrency: number;
  durationMs: number;
  errors: Record<string, number>;
  failed: number;
  latencyMs: LatencySummary;
  ok: number;
  requests: number;
  requestsPerSecond: number;
  startedAt: string;
  statusCodes: Record<string, number>;
  target: LoadTarget;
};

export type LoadTestReport = {
  baseUrl: string;
  completedAt: string;
  concurrency: number;
  environment: string;
  requests: number;
  runId: string;
  scenarios: LoadScenarioResult[];
  searchQuery: string;
  service: "lumenbazaar-backend";
  startedAt: string;
  targets: LoadTarget[];
};

type JsonRecord = Record<string, unknown>;

type LoadScenarioRunner = (index: number) => Promise<LoadSample>;

const defaultOptions: LoadTestOptions = {
  baseUrl: "http://localhost:3000",
  concurrency: 10,
  environment: "local",
  requests: 100,
  searchQuery: "weather",
  targets: ["verify", "settle", "search", "worker"]
};

export async function runLoadTests(options: Partial<LoadTestOptions> = {}) {
  const merged = normalizeOptions(options);
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const verifyTemplate = await loadTemplate(merged.verifyTemplatePath);
  const settleTemplate = await loadTemplate(merged.settleTemplatePath ?? merged.verifyTemplatePath);
  const scenarios: LoadScenarioResult[] = [];

  for (const target of merged.targets) {
    if (target === "verify") {
      scenarios.push(
        await runScenario(target, merged, (index) =>
          postJson(
            merged.baseUrl,
            "/v1/verify",
            buildExactPaymentRequest(index, runId, target, verifyTemplate)
          )
        )
      );
      continue;
    }

    if (target === "settle") {
      scenarios.push(
        await runScenario(target, merged, (index) =>
          runSettleRequest(
            merged.baseUrl,
            buildExactPaymentRequest(index, runId, target, settleTemplate)
          )
        )
      );
      continue;
    }

    if (target === "search") {
      scenarios.push(
        await runScenario(target, merged, () =>
          getJson(
            merged.baseUrl,
            `/v1/discovery/search?q=${encodeURIComponent(merged.searchQuery)}&limit=20`
          )
        )
      );
      continue;
    }

    scenarios.push(await runWorkerThroughputScenario(merged.requests, merged.concurrency));
  }

  const report: LoadTestReport = {
    baseUrl: merged.baseUrl,
    completedAt: new Date().toISOString(),
    concurrency: merged.concurrency,
    environment: merged.environment,
    requests: merged.requests,
    runId,
    scenarios,
    searchQuery: merged.searchQuery,
    service: "lumenbazaar-backend",
    startedAt,
    targets: merged.targets
  };

  if (merged.outputPath !== undefined) {
    await writeReport(merged.outputPath, report);
  }

  return report;
}

export async function runScenario(
  target: LoadTarget,
  options: Pick<LoadTestOptions, "concurrency" | "requests">,
  runner: LoadScenarioRunner
): Promise<LoadScenarioResult> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const samples: LoadSample[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(options.concurrency, options.requests);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= options.requests) {
          return;
        }

        samples.push(await captureSample(() => runner(index)));
      }
    })
  );

  return summarizeScenario({
    completedAt: new Date().toISOString(),
    concurrency: workerCount,
    durationMs: performance.now() - started,
    samples,
    startedAt,
    target
  });
}

export async function runWorkerThroughputScenario(
  requests: number,
  concurrency: number
): Promise<LoadScenarioResult> {
  const backend = new InMemoryWorkerBackend();
  const app = createWorkerApp({ backend });

  await app.start();

  try {
    return await runScenario("worker", { requests, concurrency }, async (index) => {
      const started = performance.now();

      await backend.enqueue({
        id: `load_job_${index}`,
        name: "load.worker-throughput",
        queueName: queueNames.resourceIndexing,
        data: {
          index,
          target: "worker"
        }
      });

      return {
        durationMs: performance.now() - started,
        ok: true
      };
    });
  } finally {
    await app.stop();
  }
}

export function summarizeScenario(input: {
  completedAt: string;
  concurrency: number;
  durationMs: number;
  samples: LoadSample[];
  startedAt: string;
  target: LoadTarget;
}): LoadScenarioResult {
  const statusCodes: Record<string, number> = {};
  const errors: Record<string, number> = {};
  const ok = input.samples.filter((sample) => sample.ok).length;
  const failed = input.samples.length - ok;

  for (const sample of input.samples) {
    const statusKey = sample.statusCode === undefined ? "none" : String(sample.statusCode);
    statusCodes[statusKey] = (statusCodes[statusKey] ?? 0) + 1;

    if (!sample.ok) {
      const errorKey = sample.error ?? "request_failed";
      errors[errorKey] = (errors[errorKey] ?? 0) + 1;
    }
  }

  return {
    completedAt: input.completedAt,
    concurrency: input.concurrency,
    durationMs: round(input.durationMs),
    errors,
    failed,
    latencyMs: summarizeLatency(input.samples.map((sample) => sample.durationMs)),
    ok,
    requests: input.samples.length,
    requestsPerSecond: round((input.samples.length / Math.max(input.durationMs, 1)) * 1000),
    startedAt: input.startedAt,
    statusCodes,
    target: input.target
  };
}

export function summarizeLatency(durations: number[]): LatencySummary {
  if (durations.length === 0) {
    return {
      avg: 0,
      max: 0,
      min: 0,
      p50: 0,
      p95: 0,
      p99: 0
    };
  }

  const sorted = [...durations].sort((left, right) => left - right);
  const total = sorted.reduce((sum, duration) => sum + duration, 0);

  return {
    avg: round(total / sorted.length),
    max: round(sorted[sorted.length - 1] ?? 0),
    min: round(sorted[0] ?? 0),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99))
  };
}

export function normalizeOptions(options: Partial<LoadTestOptions>): LoadTestOptions {
  const merged: LoadTestOptions = {
    ...defaultOptions,
    ...options,
    targets: options.targets ?? defaultOptions.targets
  };

  if (merged.requests < 1 || !Number.isInteger(merged.requests)) {
    throw new Error("--requests must be a positive integer.");
  }

  if (merged.concurrency < 1 || !Number.isInteger(merged.concurrency)) {
    throw new Error("--concurrency must be a positive integer.");
  }

  if (merged.concurrency > merged.requests) {
    return {
      ...merged,
      concurrency: merged.requests
    };
  }

  return merged;
}

export function parseLoadTestArgs(argv: string[]): Partial<LoadTestOptions> {
  const options: Partial<LoadTestOptions> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === undefined) {
      continue;
    }

    const next = argv[index + 1];
    const readValue = () => {
      if (next === undefined) {
        throw new Error(`${arg} requires a value.`);
      }
      index += 1;
      return next;
    };

    if (arg === "--base-url") {
      options.baseUrl = readValue();
      continue;
    }

    if (arg === "--concurrency") {
      options.concurrency = Number(readValue());
      continue;
    }

    if (arg === "--environment") {
      options.environment = readValue();
      continue;
    }

    if (arg === "--output") {
      options.outputPath = readValue();
      continue;
    }

    if (arg === "--requests") {
      options.requests = Number(readValue());
      continue;
    }

    if (arg === "--search-query") {
      options.searchQuery = readValue();
      continue;
    }

    if (arg === "--settle-template") {
      options.settleTemplatePath = readValue();
      continue;
    }

    if (arg === "--targets") {
      options.targets = parseTargets(readValue());
      continue;
    }

    if (arg === "--verify-template") {
      options.verifyTemplatePath = readValue();
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown load test option: ${arg}`);
  }

  return options;
}

export function buildExactPaymentRequest(
  index: number,
  runId: string,
  target: LoadTarget,
  template?: unknown
) {
  const paymentHash = hashForRequest(index, runId, target);
  const request =
    template === undefined
      ? defaultExactPaymentRequest(paymentHash)
      : materializeTemplate(template, {
          index: String(index),
          paymentHash,
          runId,
          target
        });

  return ensurePaymentHash(request, paymentHash);
}

async function runSettleRequest(baseUrl: string, request: unknown): Promise<LoadSample> {
  const started = performance.now();
  const verify = await postJsonWithBody(baseUrl, "/v1/verify", request);

  if (!verify.sample.ok) {
    return {
      durationMs: performance.now() - started,
      error: `verify setup failed: ${sampleError(verify.sample)}`,
      ok: false,
      ...(verify.sample.statusCode === undefined ? {} : { statusCode: verify.sample.statusCode })
    };
  }

  const paymentAttemptId = readPaymentAttemptId(verify.body);

  if (paymentAttemptId === undefined) {
    return {
      durationMs: performance.now() - started,
      error: "verify setup did not return paymentAttemptId",
      ok: false,
      ...(verify.sample.statusCode === undefined ? {} : { statusCode: verify.sample.statusCode })
    };
  }

  const settle = await postJsonWithBody(baseUrl, "/v1/settle", {
    ...asRecord(request),
    paymentAttemptId
  });

  return {
    ...settle.sample,
    durationMs: performance.now() - started
  };
}

async function getJson(baseUrl: string, path: string): Promise<LoadSample> {
  return requestJson(new URL(path, withTrailingSlash(baseUrl)), {
    method: "GET"
  }).then((result) => result.sample);
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<LoadSample> {
  return postJsonWithBody(baseUrl, path, body).then((result) => result.sample);
}

async function postJsonWithBody(baseUrl: string, path: string, body: unknown) {
  return requestJson(new URL(path, withTrailingSlash(baseUrl)), {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
}

async function requestJson(
  url: URL,
  init: RequestInit
): Promise<{ body: unknown; sample: LoadSample }> {
  const started = performance.now();

  try {
    const response = await fetch(url, init);
    const text = await response.text();
    const sample: LoadSample = {
      durationMs: performance.now() - started,
      ok: response.ok,
      statusCode: response.status
    };

    if (!response.ok) {
      sample.error = response.statusText || `HTTP ${response.status}`;
    }

    return {
      body: parseJsonBody(text),
      sample
    };
  } catch (error) {
    return {
      body: undefined,
      sample: {
        durationMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
        ok: false
      }
    };
  }
}

async function captureSample(runner: () => Promise<LoadSample>): Promise<LoadSample> {
  try {
    return await runner();
  } catch (error) {
    return {
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error),
      ok: false
    };
  }
}

function defaultExactPaymentRequest(paymentHash: string) {
  return {
    paymentPayload: {
      scheme: "exact",
      network: "stellar:testnet" satisfies NetworkId,
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo: localIssuerPublicKey,
      expiresAtLedger: 1000000000,
      authorization: {
        loadTest: true
      },
      paymentHash
    },
    paymentRequirements: {
      scheme: "exact",
      network: "stellar:testnet" satisfies NetworkId,
      asset: {
        code: "USDC",
        issuer: localIssuerPublicKey
      },
      amount: "0.05",
      payTo: localIssuerPublicKey
    },
    currentLedger: 1
  };
}

function parseTargets(value: string): LoadTarget[] {
  const rawTargets = value
    .split(",")
    .map((target) => target.trim())
    .filter((target) => target.length > 0);

  if (rawTargets.length === 0) {
    throw new Error("--targets must include at least one target.");
  }

  const targets: LoadTarget[] = [];

  for (const target of rawTargets) {
    if (!isLoadTarget(target)) {
      throw new Error(`Unsupported load target: ${target}`);
    }

    targets.push(target);
  }

  return targets;
}

function isLoadTarget(value: string): value is LoadTarget {
  return loadTargets.includes(value as LoadTarget);
}

function percentile(sortedDurations: number[], percentileValue: number) {
  if (sortedDurations.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedDurations.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sortedDurations.length) - 1)
  );

  return sortedDurations[index] ?? 0;
}

function parseJsonBody(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readPaymentAttemptId(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  const paymentAttemptId = (body as JsonRecord).paymentAttemptId;

  return typeof paymentAttemptId === "string" ? paymentAttemptId : undefined;
}

function ensurePaymentHash(request: unknown, paymentHash: string) {
  const record = asRecord(request);
  const paymentPayload = asRecord(record.paymentPayload);

  return {
    ...record,
    paymentPayload: {
      ...paymentPayload,
      paymentHash
    }
  };
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return {};
}

function materializeTemplate(
  value: unknown,
  replacements: Record<"index" | "paymentHash" | "runId" | "target", string>
): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll("{index}", replacements.index)
      .replaceAll("{paymentHash}", replacements.paymentHash)
      .replaceAll("{runId}", replacements.runId)
      .replaceAll("{target}", replacements.target);
  }

  if (Array.isArray(value)) {
    return value.map((item) => materializeTemplate(item, replacements));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, materializeTemplate(entry, replacements)])
    );
  }

  return value;
}

function sampleError(sample: LoadSample) {
  if (sample.error !== undefined) {
    return sample.error;
  }

  if (sample.statusCode !== undefined) {
    return `HTTP ${sample.statusCode}`;
  }

  return "request_failed";
}

async function loadTemplate(path: string | undefined) {
  if (path === undefined) {
    return undefined;
  }

  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

async function writeReport(path: string, report: LoadTestReport) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function createRunId() {
  return `load_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function hashForRequest(index: number, runId: string, target: LoadTarget) {
  return `${runId}_${target}_${index}`;
}

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function printUsage() {
  console.log(`Usage: pnpm load:test [options]

Options:
  --base-url <url>            API base URL. Defaults to http://localhost:3000.
  --environment <name>        Baseline label such as local, staging, or testnet.
  --targets <list>            Comma-separated targets: verify,settle,search,worker.
  --requests <number>         Total requests per target. Defaults to 100.
  --concurrency <number>      Concurrent workers per target. Defaults to 10.
  --search-query <query>      Discovery search query. Defaults to weather.
  --verify-template <path>    JSON request template for /v1/verify.
  --settle-template <path>    JSON request template used before /v1/settle.
  --output <path>             Write JSON report to a file.
`);
}

async function main() {
  const report = await runLoadTests(parseLoadTestArgs(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;

if (entrypoint === import.meta.url) {
  await main();
}
