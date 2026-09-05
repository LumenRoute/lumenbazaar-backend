import { type FastifyInstance } from "fastify";

import { type AppConfig, listConfiguredNetworks, serviceName } from "@lumenbazaar/shared";

import { apiOpenApiSpec } from "../openapi.js";
import { type MetricsService } from "../services/metrics.js";

export type MetadataRouteOptions = {
  config: AppConfig;
  metrics: MetricsService;
};

export function registerMetadataRoutes(app: FastifyInstance, options: MetadataRouteOptions) {
  app.get("/health", async () => ({
    ok: true,
    service: serviceName,
    app: "api",
    dependencies: {
      database: "configured",
      redis: "configured"
    }
  }));

  app.get("/version", async () => ({
    service: serviceName,
    version: "0.1.0",
    environment: options.config.lumenEnv
  }));

  app.get("/openapi.json", async () => apiOpenApiSpec);
  app.get("/v1/openapi.json", async () => apiOpenApiSpec);

  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return options.metrics.collect();
  });

  app.get("/v1/networks", async () => ({
    networks: listConfiguredNetworks(options.config).map((network) => ({
      id: network.id,
      displayName: network.displayName,
      passphrase: network.passphrase,
      rpcUrl: network.rpcUrl,
      horizonUrl: network.horizonUrl,
      assets: network.assets
    }))
  }));
}
