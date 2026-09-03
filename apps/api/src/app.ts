import Fastify from "fastify";

import { serviceName } from "@lumenbazaar/shared";

export function buildApiApp() {
  const app = Fastify({
    logger: true
  });

  app.get("/health", async () => ({
    ok: true,
    service: serviceName,
    app: "api"
  }));

  return app;
}
