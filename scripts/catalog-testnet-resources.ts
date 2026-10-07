import { pathToFileURL } from "node:url";

import { createPaidMcpToolCatalogMetadata } from "../apps/examples/paid-mcp-tool/src/main.js";
import { createRagCatalogMetadata } from "../apps/examples/paid-rag-api/src/main.js";
import { createWeatherCatalogMetadata } from "../apps/examples/paid-weather-api/src/main.js";

type CatalogSeedConfig = {
  apiUrl: string;
  mcpBaseUrl: string;
  mcpSellerId: string;
  ragBaseUrl: string;
  ragSellerId: string;
  weatherBaseUrl: string;
  weatherSellerId: string;
};

type CatalogResult = {
  catalogEventId: string;
  indexingStatus: "queued";
  ok: true;
  resourceId: string;
  versionId: string;
};

export async function catalogTestnetResources(
  config: CatalogSeedConfig,
  fetchImpl: typeof fetch = fetch
) {
  const apiUrl = normalizedHttpsUrl(config.apiUrl, "apiUrl");
  const entries = [
    {
      key: "weather",
      metadata: createWeatherCatalogMetadata({
        baseUrl: normalizedHttpsUrl(config.weatherBaseUrl, "weatherBaseUrl"),
        sellerId: required(config.weatherSellerId, "weatherSellerId")
      })
    },
    {
      key: "rag",
      metadata: createRagCatalogMetadata({
        baseUrl: normalizedHttpsUrl(config.ragBaseUrl, "ragBaseUrl"),
        sellerId: required(config.ragSellerId, "ragSellerId")
      })
    },
    {
      key: "mcp",
      metadata: createPaidMcpToolCatalogMetadata({
        baseUrl: normalizedHttpsUrl(config.mcpBaseUrl, "mcpBaseUrl"),
        sellerId: required(config.mcpSellerId, "mcpSellerId")
      })
    }
  ] as const;
  const published: Array<{ key: string; resourceId: string; versionId: string }> = [];

  for (const entry of entries) {
    const validation = await requestJson<{ errors: unknown[]; ok: boolean }>(
      fetchImpl,
      `${apiUrl}/v1/discovery/validate`,
      { method: "POST", body: entry.metadata }
    );
    if (!validation.ok) {
      throw new Error(
        `${entry.key} metadata validation failed: ${JSON.stringify(validation.errors)}`
      );
    }

    const cataloged = await requestJson<CatalogResult>(
      fetchImpl,
      `${apiUrl}/v1/discovery/catalog`,
      { method: "POST", body: entry.metadata }
    );
    const inspected = await requestJson<{ id: string }>(
      fetchImpl,
      `${apiUrl}/v1/resources/${encodeURIComponent(cataloged.resourceId)}`
    );
    if (inspected.id !== cataloged.resourceId) {
      throw new Error(`${entry.key} resource inspection returned the wrong record.`);
    }
    published.push({
      key: entry.key,
      resourceId: cataloged.resourceId,
      versionId: cataloged.versionId
    });
  }

  await assertDiscoverable(fetchImpl, apiUrl, published);
  return { apiUrl, published };
}

async function assertDiscoverable(
  fetchImpl: typeof fetch,
  apiUrl: string,
  published: Array<{ key: string; resourceId: string }>
) {
  const browse = await requestJson<{ resources: Array<{ id: string }> }>(
    fetchImpl,
    `${apiUrl}/v1/discovery/resources?network=stellar%3Atestnet&limit=100`
  );
  const search = await requestJson<{ resources: Array<{ id: string }> }>(
    fetchImpl,
    `${apiUrl}/v1/discovery/search?network=stellar%3Atestnet&limit=100`
  );
  const expected = new Set(published.map((entry) => entry.resourceId));
  for (const [surface, resources] of [
    ["browse", browse.resources],
    ["search", search.resources]
  ] as const) {
    const actual = new Set(resources.map((resource) => resource.id));
    if ([...expected].some((resourceId) => !actual.has(resourceId))) {
      throw new Error(`Published resources are missing from discovery ${surface}.`);
    }
  }
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  options: { body?: unknown; method?: "POST" } = {}
) {
  const response = await fetchImpl(url, {
    ...(options.method === undefined ? {} : { method: options.method }),
    ...(options.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options.body)
        })
  });
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${url} failed: ${response.status} ${await response.text()}`
    );
  }
  return response.json() as Promise<T>;
}

function normalizedHttpsUrl(value: string, name: string) {
  const url = new URL(required(value, name));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a credential-free HTTPS base URL.`);
  }
  return url.toString().replace(/\/$/u, "");
}

function required(value: string, name: string) {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function configFromEnvironment(): CatalogSeedConfig {
  return {
    apiUrl: process.env.API_BASE_URL ?? "",
    weatherBaseUrl: process.env.WEATHER_RESOURCE_BASE_URL ?? "",
    weatherSellerId: process.env.WEATHER_SELLER_ID ?? "",
    ragBaseUrl: process.env.RAG_RESOURCE_BASE_URL ?? "",
    ragSellerId: process.env.RAG_SELLER_ID ?? "",
    mcpBaseUrl: process.env.MCP_RESOURCE_BASE_URL ?? "",
    mcpSellerId: process.env.MCP_SELLER_ID ?? ""
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  catalogTestnetResources(configFromEnvironment())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
