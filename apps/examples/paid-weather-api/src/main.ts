import Fastify, { type FastifyRequest } from "fastify";

import {
  createBudgetManager,
  createDefaultBudget,
  runPaidResourceFlow,
  type CallOptions,
  type PaidResourceFlowResult
} from "@lumenbazaar/buyer-sdk";
import {
  httpResource,
  paymentRequirement,
  sendFastifyPaymentRequired
} from "@lumenbazaar/seller-sdk";
import { localIssuerPublicKey, serviceName, type JsonObject } from "@lumenbazaar/shared";

export const weatherPaymentRequirement = paymentRequirement({
  network: "stellar:testnet",
  assetCode: "USDC",
  assetIssuer: localIssuerPublicKey,
  amount: "0.02",
  payTo: localIssuerPublicKey
});

export const weatherInputSchema: JsonObject = {
  type: "object",
  properties: {
    city: {
      type: "string",
      minLength: 1,
      description: "City name to fetch weather for."
    }
  },
  required: ["city"],
  additionalProperties: false
};

export const weatherOutputSchema: JsonObject = {
  type: "object",
  properties: {
    city: {
      type: "string"
    },
    condition: {
      type: "string"
    },
    temperatureC: {
      type: "number"
    },
    humidityPercent: {
      type: "number"
    },
    paid: {
      type: "boolean"
    }
  },
  required: ["city", "condition", "temperatureC", "humidityPercent", "paid"],
  additionalProperties: false
};

export const weatherResourceMetadata = httpResource({
  name: "Paid Weather API",
  description: "Returns deterministic testnet weather data after an exact x402 payment.",
  url: "https://weather.example.test/weather/Lagos",
  routeTemplate: "/weather/{city}",
  inputSchema: weatherInputSchema,
  outputSchema: weatherOutputSchema,
  trusted: false
});

export type WeatherCatalogOptions = {
  baseUrl?: string;
  sellerId?: string;
};

export type WeatherExampleOptions = WeatherCatalogOptions & {
  logger?: boolean;
};

export type WeatherForecast = {
  city: string;
  condition: string;
  humidityPercent: number;
  paid: true;
  temperatureC: number;
};

export type PublishWeatherMetadataOptions = Required<WeatherCatalogOptions> & {
  apiUrl: string;
  fetchImpl?: typeof fetch;
};

export type CallWeatherBuyerOptions = CallOptions & {
  apiUrl: string;
  authorization?: Record<string, unknown>;
  city: string;
  currentLedger?: number;
  expiresAtLedger?: number;
  resourceId: string;
  sellerBaseUrl?: string;
};

export function createWeatherCatalogMetadata(options: WeatherCatalogOptions = {}) {
  const baseUrl = options.baseUrl ?? "https://weather.example.test";
  const sellerId = options.sellerId ?? "seller_weather_example";

  return {
    metadataVersion: 1 as const,
    sellerId,
    resource: {
      ...weatherResourceMetadata.resource,
      url: `${baseUrl.replace(/\/$/, "")}/weather/Lagos`,
      network: weatherPaymentRequirement.network,
      payTo: weatherPaymentRequirement.payTo,
      assetCode: weatherPaymentRequirement.asset.code,
      assetIssuer: weatherPaymentRequirement.asset.issuer,
      amount: weatherPaymentRequirement.amount,
      extensions: {
        ...weatherResourceMetadata.resource.extensions,
        bazaar: true,
        example: "paid-weather-api",
        testnet: true
      }
    }
  };
}

export function createWeatherApp(options: WeatherExampleOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const metadata = createWeatherCatalogMetadata(options);

  app.get("/.well-known/lumenbazaar.json", async () => metadata);
  app.get("/metadata", async () => metadata);

  app.route<{ Params: { city: string } }>({
    method: ["GET", "POST"],
    url: "/weather/:city",
    handler: async (request, reply) => {
      if (!hasPaymentHeader(request)) {
        return sendFastifyPaymentRequired(reply, weatherPaymentRequirement);
      }

      return forecastForCity(request.params.city);
    }
  });

  return app;
}

export async function publishWeatherMetadata(options: PublishWeatherMetadataOptions) {
  const response = await (options.fetchImpl ?? fetch)(
    `${options.apiUrl.replace(/\/$/, "")}/v1/discovery/catalog`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        createWeatherCatalogMetadata({
          baseUrl: options.baseUrl,
          sellerId: options.sellerId
        })
      )
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to publish weather metadata: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<JsonObject>;
}

export async function callWeatherWithBuyerSdk(
  options: CallWeatherBuyerOptions
): Promise<PaidResourceFlowResult> {
  const baseUrl = (options.sellerBaseUrl ?? "https://weather.example.test").replace(/\/$/, "");
  const budgetManager = createBudgetManager(createDefaultBudget("stellar:testnet"));

  return runPaidResourceFlow({
    apiUrl: options.apiUrl,
    budgetManager,
    ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
    ...(options.currentLedger === undefined ? {} : { currentLedger: options.currentLedger }),
    ...(options.expiresAtLedger === undefined ? {} : { expiresAtLedger: options.expiresAtLedger }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    resourceId: options.resourceId,
    resourceUrl: `${baseUrl}/weather/${encodeURIComponent(options.city)}`
  });
}

export async function startWeatherExample() {
  const app = createWeatherApp({ logger: true });
  const port = Number(process.env.PORT ?? 4010);
  await app.listen({ host: "0.0.0.0", port });
  console.log(`${serviceName} paid weather API example listening on ${port}`);
}

function hasPaymentHeader(request: FastifyRequest) {
  return typeof request.headers["x-payment-required"] === "string";
}

function forecastForCity(city: string): WeatherForecast {
  const normalized = decodeURIComponent(city).trim() || "Unknown";
  const seed = [...normalized].reduce((sum, character) => sum + character.charCodeAt(0), 0);

  return {
    city: normalized,
    condition: seed % 2 === 0 ? "clear" : "cloudy",
    humidityPercent: 45 + (seed % 40),
    paid: true,
    temperatureC: 18 + (seed % 17)
  };
}

if (process.env.NODE_ENV !== "test") {
  startWeatherExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
