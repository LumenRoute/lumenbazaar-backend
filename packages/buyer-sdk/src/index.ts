export const buyerSdkPackage = "@lumenbazaar/buyer-sdk";

// Search exports
export {
  searchResources,
  searchByName,
  searchByNetwork,
  searchByAsset,
  searchMcpTools,
  searchHttpEndpoints
} from "./search.js";
export type { SearchFilters, SearchResult, SearchResponse } from "./search.js";

// Inspect exports
export {
  inspectResource,
  getPaymentTerms,
  isResourceAvailableOnNetwork,
  getResourceInputSchema,
  getResourceOutputSchema
} from "./inspect.js";
export type { PaymentTerms, ResourceMetadata } from "./inspect.js";

// Payment exports
export {
  preparePaymentPayload,
  createPaymentPayloadFromResource,
  isPaymentExpired,
  getPaymentTimeRemaining,
  validatePaymentPayload,
  serializePaymentPayload,
  deserializePaymentPayload,
  createPaymentHeaders
} from "./payment.js";
export type { PaymentPayload, PaymentPrepareInput } from "./payment.js";

// Call exports
export { callPaidResource, fetchReceipt } from "./call.js";
export type { CallOptions, CallResult, RetryConfig } from "./call.js";

// Budget exports
export { BudgetManager, createBudgetManager, createDefaultBudget } from "./budget.js";
export type { BudgetConstraint, BudgetState } from "./budget.js";

// Error exports
export {
  mapHttpStatusToErrorCode,
  mapResponseError,
  mapCaughtError,
  mapLumenError
} from "./errors.js";
export type { ErrorCode, MappedError } from "./errors.js";
