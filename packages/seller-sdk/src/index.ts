export const sellerSdkPackage = "@lumenbazaar/seller-sdk";

// Middleware exports
export {
  createPaymentRequired,
  createExpressPaymentMiddleware,
  createNextPaymentResponse,
  createFastifyPaymentMiddleware,
  sendFastifyPaymentRequired
} from "./middleware.js";
export type {
  FastifyPaymentPluginHost,
  FastifyPaymentReply,
  MiddlewareResponse,
  PaymentRequirement,
  X402PaymentHeader
} from "./middleware.js";

// Payment builder exports
export {
  createPaymentRequirement,
  paymentRequirement,
  PaymentRequirementBuilder
} from "./paymentBuilder.js";

// Metadata builder exports
export {
  createMetadata,
  httpResource,
  mcpResource,
  parseMetadata,
  MetadataBuilder
} from "./metadataBuilder.js";
export type {
  ResourceMetadata,
  HttpResourceMetadata,
  McpResourceMetadata
} from "./metadataBuilder.js";

// Validation exports
export {
  validateRouteTemplate,
  validateJsonSchema,
  validateSchemaPair,
  validateMcpToolMetadata,
  validateHttpEndpointMetadata,
  matchRouteParamsToSchema
} from "./validation.js";
export type { ValidationResult } from "./validation.js";
