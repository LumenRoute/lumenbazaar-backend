import { type FastifyInstance } from "fastify";
import { z } from "zod";

import { type PaymentSessionService } from "@lumenbazaar/stellar-payments";

import { parseBody, parseParams } from "../http/validation.js";

export type PaymentSessionRouteOptions = {
  paymentSessionService: PaymentSessionService;
};

export function registerPaymentSessionRoutes(
  app: FastifyInstance,
  options: PaymentSessionRouteOptions
) {
  app.post("/v1/payment-sessions", async (request) =>
    options.paymentSessionService.createSession(parseBody(request, z.unknown()))
  );

  app.get("/v1/payment-sessions/:sessionId", async (request) => {
    const params = parseParams(request, z.object({ sessionId: z.string().min(1) }));
    return options.paymentSessionService.getSession(params.sessionId);
  });

  app.post("/v1/payment-sessions/:sessionId/settle", async (request) => {
    const params = parseParams(request, z.object({ sessionId: z.string().min(1) }));
    const body = parseBody(request, z.record(z.string(), z.unknown()));

    return options.paymentSessionService.settleSession({
      ...body,
      sessionId: params.sessionId
    });
  });
}
