import { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { LumenError, failure, mapInfrastructureError, toPublicError } from "@lumenbazaar/shared";

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).send(
      failure(
        {
          code: "RESOURCE_NOT_FOUND",
          message: `Route ${request.method} ${request.url} was not found.`
        },
        request.id
      )
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof LumenError) {
      return reply.status(error.statusCode).send(failure(toPublicError(error), request.id));
    }

    if (error instanceof ZodError || isFastifyValidationError(error)) {
      return reply.status(400).send(
        failure(
          {
            code: "VALIDATION_FAILED",
            message: "Request validation failed.",
            details: {
              issues: error instanceof ZodError ? error.issues : error.validation
            }
          },
          request.id
        )
      );
    }

    const mappedError = mapInfrastructureError(error);

    request.log.error({ code: mappedError.code, err: error }, "Unhandled API error");

    return reply
      .status(mappedError.statusCode)
      .send(failure(toPublicError(mappedError), request.id));
  });
}

function isFastifyValidationError(error: unknown): error is FastifyError & {
  validation: unknown;
} {
  return (error as { validation?: unknown }).validation !== undefined;
}
