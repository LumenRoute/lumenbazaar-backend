import { Gauge, Registry } from "prom-client";

export type MetricsService = {
  collect: () => Promise<string>;
};

export function createMetricsService(): MetricsService {
  const registry = new Registry();
  const uptime = new Gauge({
    name: "lumenbazaar_api_uptime_seconds",
    help: "API process uptime in seconds.",
    registers: [registry]
  });

  return {
    async collect() {
      uptime.set(process.uptime());
      return registry.metrics();
    }
  };
}
