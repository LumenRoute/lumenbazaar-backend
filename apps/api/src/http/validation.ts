import { type FastifyRequest } from "fastify";
import { type z } from "zod";

export function parseBody<TSchema extends z.ZodType>(request: FastifyRequest, schema: TSchema) {
  return schema.parse(request.body) as z.output<TSchema>;
}

export function parseQuery<TSchema extends z.ZodType>(request: FastifyRequest, schema: TSchema) {
  return schema.parse(request.query) as z.output<TSchema>;
}

export function parseParams<TSchema extends z.ZodType>(request: FastifyRequest, schema: TSchema) {
  return schema.parse(request.params) as z.output<TSchema>;
}
