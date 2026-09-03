export const sellerSdkPackage = "@lumenbazaar/seller-sdk";

// Middleware exports
export { createPaymentRequired, createExpressPaymentMiddleware, createNextPaymentResponse, createFastifyPaymentMiddleware } from "./middleware.js";
export type { PaymentRequirement, MiddlewareResponse, X402PaymentHeader } from "./middleware.js";

// Payment builder exports
export { createPaymentRequirement, paymentRequirement, PaymentRequirementBuilder } from "./paymentBuilder.js";

// Metadata builder exports
export { createMetadata, httpResource, mcpResource, MetadataBuilder } from "./metadataBuilder.js";
export type { ResourceMetadata, HttpResourceMetadata, McpResourceMetadata } from "./metadataBuilder.js";
