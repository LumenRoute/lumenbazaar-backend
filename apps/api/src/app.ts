import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { loadConfig, serviceName } from "@lumenbazaar/shared";

import { registerErrorHandling } from "./http/errors.js";

export type BuildApiAppOptions = {
  logger?: boolean;
};

export function buildApiApp(options: BuildApiAppOptions = {}) {
  const config = loadConfig();
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: options.logger ?? config.nodeEnv !== "test"
  });

  registerErrorHandling(app);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["ok", "service", "app"],
            properties: {
              ok: { type: "boolean" },
              service: { type: "string" },
              app: { type: "string" }
            }
          }
        }
      }
    },
    async () => ({
      ok: true,
      service: serviceName,
      app: "api"
    })
  );

  return app;
}
