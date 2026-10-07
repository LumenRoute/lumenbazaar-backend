import { type FastifyInstance } from "fastify";

import { type AppConfig, listConfiguredNetworks, serviceName } from "@lumenbazaar/shared";

import { apiOpenApiSpec } from "../openapi.js";
import { type MetricsService } from "../services/metrics.js";
import { type OperationalMetricsRefresher } from "../services/operationalMetrics.js";
import { type ReadinessService } from "../services/readiness.js";

export type MetadataRouteOptions = {
  config: AppConfig;
  metrics: MetricsService;
  readiness: ReadinessService;
  operationalMetrics?: OperationalMetricsRefresher;
};

export function registerMetadataRoutes(app: FastifyInstance, options: MetadataRouteOptions) {
  app.get("/health", async () => ({
    ok: true,
    service: serviceName,
    app: "api"
  }));

  app.get("/ready", async (_request, reply) => {
    const report = await options.readiness.evaluate();
    options.metrics.setDependencyStatus("postgres", report.checks.database.status === "ready");
    options.metrics.setDependencyStatus("redis", report.checks.redis.status === "ready");
    options.metrics.setDependencyStatus("rpc", report.checks.stellarRpc.status === "ready");
    options.metrics.setDependencyStatus("horizon", report.checks.horizon.status === "ready");
    options.metrics.setDependencyStatus("signer", report.checks.signer.status !== "unavailable");
    reply.code(report.ok ? 200 : 503);
    return report;
  });

  app.get("/version", async () => ({
    service: serviceName,
    version: "0.1.0",
    environment: options.config.lumenEnv
  }));

  app.get("/openapi.json", async () => apiOpenApiSpec);
  app.get("/v1/openapi.json", async () => apiOpenApiSpec);

  app.get("/metrics", async (_request, reply) => {
    await options.operationalMetrics?.refresh();
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
