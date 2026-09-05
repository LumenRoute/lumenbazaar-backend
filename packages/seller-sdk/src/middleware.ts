import { type JsonObject } from "@lumenbazaar/shared";

export type PaymentRequirement = {
  scheme: "exact";
  network: "stellar:testnet" | "stellar:pubnet";
  asset: {
    code: string;
    issuer: string;
  };
  amount: string;
  payTo: string;
};

export type X402PaymentHeader = {
  "x-payment-required"?: string;
  "x-payment-scheme"?: string;
};

/**
 * Middleware Response
 * Represents a 402 Payment Required response with x402 headers
 */
export type MiddlewareResponse = {
  status: 402;
  headers: X402PaymentHeader;
  body?: JsonObject;
};

export type FastifyPaymentReply = {
  code?: (statusCode: number) => FastifyPaymentReply;
  header?: (name: string, value: string) => FastifyPaymentReply;
  headers?: (headers: Record<string, string>) => FastifyPaymentReply;
  send: (body: JsonObject) => unknown;
  status?: (statusCode: number) => FastifyPaymentReply;
};

export type FastifyPaymentPluginHost = {
  decorate: (
    name: "lumenBazaar",
    value: {
      requirePayment: (
        request: Record<string, unknown>,
        reply: FastifyPaymentReply,
        overrideRequirement?: PaymentRequirement
      ) => unknown;
    }
  ) => void;
};

/**
 * Create a 402 Payment Required response
 */
export function createPaymentRequired(requirement: PaymentRequirement): MiddlewareResponse {
  const paymentHeaderValue = JSON.stringify({
    scheme: requirement.scheme,
    network: requirement.network,
    asset: requirement.asset,
    amount: requirement.amount,
    payTo: requirement.payTo
  });

  return {
    status: 402,
    headers: {
      "x-payment-required": paymentHeaderValue,
      "x-payment-scheme": requirement.scheme
    },
    body: {
      error: "Payment Required",
      message: "This resource requires payment to access",
      paymentRequired: requirement
    }
  };
}

/**
 * Fastify plugin for 402 Payment Required responses.
 */
export function createFastifyPaymentMiddleware(requirement: PaymentRequirement) {
  return async (fastify: FastifyPaymentPluginHost) => {
    fastify.decorate("lumenBazaar", {
      requirePayment: (
        _request: Record<string, unknown>,
        reply: FastifyPaymentReply,
        overrideRequirement: PaymentRequirement = requirement
      ) => sendFastifyPaymentRequired(reply, overrideRequirement)
    });
  };
}

export function sendFastifyPaymentRequired(
  reply: FastifyPaymentReply,
  requirement: PaymentRequirement
) {
  const paymentResponse = createPaymentRequired(requirement);
  const headers = {
    "x-payment-required": paymentResponse.headers["x-payment-required"] ?? "",
    "x-payment-scheme": paymentResponse.headers["x-payment-scheme"] ?? ""
  };

  if (reply.code !== undefined) {
    reply.code(paymentResponse.status);
  } else if (reply.status !== undefined) {
    reply.status(paymentResponse.status);
  }

  if (reply.headers !== undefined) {
    reply.headers(headers);
  } else if (reply.header !== undefined) {
    for (const [name, value] of Object.entries(headers)) {
      reply.header(name, value);
    }
  }

  return reply.send(paymentResponse.body ?? {});
}

/**
 * Express Middleware for 402 Payment Required responses
 * Usage: app.use(createExpressPaymentMiddleware(requirement))
 */
export function createExpressPaymentMiddleware(requirement: PaymentRequirement) {
  return (
    _req: Record<string, unknown>,
    res: {
      status: (code: number) => {
        set: (headers: Record<string, string>) => {
          json: (body: JsonObject) => void;
        };
      };
    },
    _next: () => void
  ) => {
    const paymentResponse = createPaymentRequired(requirement);

    res
      .status(paymentResponse.status)
      .set({
        "x-payment-required": paymentResponse.headers["x-payment-required"] ?? "",
        "x-payment-scheme": paymentResponse.headers["x-payment-scheme"] ?? ""
      })
      .json(paymentResponse.body ?? {});
  };
}

/**
 * Next.js Route Handler Response for 402 Payment Required
 * Usage: return createNextPaymentResponse(requirement)
 */
export function createNextPaymentResponse(requirement: PaymentRequirement) {
  const paymentResponse = createPaymentRequired(requirement);

  return new Response(JSON.stringify(paymentResponse.body), {
    status: paymentResponse.status,
    headers: {
      "Content-Type": "application/json",
      "x-payment-required": paymentResponse.headers["x-payment-required"] ?? "",
      "x-payment-scheme": paymentResponse.headers["x-payment-scheme"] ?? ""
    }
  });
}
