import { type PaymentRequiredV2 } from "@x402/core/schemas";

import {
  encodePaymentRequiredV2,
  paymentRequiredHeader,
  type ExactStellarPaymentRequirements
} from "@lumenbazaar/stellar-payments";

export type PaymentRequirement = ExactStellarPaymentRequirements;

export type PaymentResource = {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
};

export type X402PaymentHeader = {
  "payment-required": string;
};

export type MiddlewareResponse = {
  status: 402;
  headers: X402PaymentHeader;
  body: PaymentRequiredV2;
};

export type FastifyPaymentReply = {
  code?: (statusCode: number) => FastifyPaymentReply;
  header?: (name: string, value: string) => FastifyPaymentReply;
  headers?: (headers: Record<string, string>) => FastifyPaymentReply;
  send: (body: Record<string, unknown>) => unknown;
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

const defaultResource: PaymentResource = {
  url: "https://lumenbazaar.invalid/resource",
  description: "Paid LumenBazaar resource"
};

export function createPaymentRequired(
  requirement: PaymentRequirement,
  resource: PaymentResource = defaultResource
): MiddlewareResponse {
  const body: PaymentRequiredV2 = {
    x402Version: 2,
    resource,
    accepts: [requirement]
  };

  return {
    status: 402,
    headers: {
      "payment-required": encodePaymentRequiredV2(body)
    },
    body
  };
}

export function createFastifyPaymentMiddleware(
  requirement: PaymentRequirement,
  resource: PaymentResource = defaultResource
) {
  return async (fastify: FastifyPaymentPluginHost) => {
    fastify.decorate("lumenBazaar", {
      requirePayment: (
        _request: Record<string, unknown>,
        reply: FastifyPaymentReply,
        overrideRequirement: PaymentRequirement = requirement
      ) => sendFastifyPaymentRequired(reply, overrideRequirement, resource)
    });
  };
}

export function sendFastifyPaymentRequired(
  reply: FastifyPaymentReply,
  requirement: PaymentRequirement,
  resource: PaymentResource = defaultResource
) {
  const paymentResponse = createPaymentRequired(requirement, resource);
  setStatus(reply, paymentResponse.status);
  setHeaders(reply, paymentResponse.headers);
  return reply.send(paymentResponse.body);
}

export function createExpressPaymentMiddleware(
  requirement: PaymentRequirement,
  resource: PaymentResource = defaultResource
) {
  return (
    _req: Record<string, unknown>,
    res: {
      status: (code: number) => {
        set: (headers: Record<string, string>) => { json: (body: unknown) => unknown };
      };
    }
  ) => {
    const response = createPaymentRequired(requirement, resource);
    return res.status(response.status).set(response.headers).json(response.body);
  };
}

export function createNextPaymentResponse(
  requirement: PaymentRequirement,
  resource: PaymentResource = defaultResource
) {
  return createPaymentRequired(requirement, resource);
}

function setStatus(reply: FastifyPaymentReply, status: number) {
  if (reply.code !== undefined) {
    reply.code(status);
  } else {
    reply.status?.(status);
  }
}

function setHeaders(reply: FastifyPaymentReply, headers: Record<string, string>) {
  if (reply.headers !== undefined) {
    reply.headers(headers);
    return;
  }
  for (const [name, value] of Object.entries(headers)) {
    reply.header?.(name === "payment-required" ? paymentRequiredHeader : name, value);
  }
}
