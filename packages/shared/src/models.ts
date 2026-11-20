import { type NetworkId } from "./networks.js";
import { type SellerStatus } from "./sellerSuspension.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export type JsonObject = {
  [key: string]: JsonValue;
};

export type ResourceType = "http" | "mcp";
export type ResourceStatus = "draft" | "active" | "inactive";
export type PaymentScheme = "exact" | "upto";
export type PaymentStatus =
  | "received"
  | "verified"
  | "settling"
  | "submitted"
  | "confirmed"
  | "settled"
  | "expired"
  | "timed_out"
  | "failed";
export type SettlementStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "settled"
  | "timed_out"
  | "failed";
export type ReceiptStatus = "pending" | "finalized" | "failed";
export type PaymentSessionStatus = "open" | "settled" | "cancelled" | "expired";
export type CatalogEventType = "validated" | "cataloged" | "updated" | "deleted";

export type Seller = {
  id: string;
  displayName: string;
  walletAddress: string;
  domain: string;
  domainVerifiedAt: string | null;
  /** Seller lifecycle status: `active` or `suspended`. Suspended sellers cannot perform write or paid-resource operations. */
  status: SellerStatus;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SellerDomain = {
  id: string;
  sellerId: string;
  domain: string;
  verificationMethod: "well-known" | "dns";
  challengeToken: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRequirement = {
  id: string;
  resourceId: string;
  scheme: PaymentScheme;
  network: NetworkId;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  payTo: string;
  createdAt: string;
};

export type ResourceSchema = {
  id: string;
  resourceId: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  createdAt: string;
};

export type Resource = {
  displayUrl?: string | null | undefined;
  id: string;
  sellerId: string;
  type: ResourceType;
  name: string;
  description: string;
  url: string;
  routeTemplate: string;
  network: NetworkId;
  payTo: string;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  extensions: JsonObject;
  status: ResourceStatus;
  /** Optimistic-concurrency version. Starts at 1 and increments on every update. */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** When the resource was soft-deleted (NULL if not deleted). */
  deletedAt?: string | null;
  /** Seller ID that performed the soft-delete. */
  deletedBy?: string | null;
  /** Deadline after which the resource can no longer be restored. */
  restoreDeadline?: string | null;
  /** When the resource was permanently purged (NULL if not purged). */
  purgedAt?: string | null;
};

export type ResourceVersion = {
  id: string;
  resourceId: string;
  version: number;
  metadata: JsonObject;
  createdAt: string;
};

export type CatalogEvent = {
  id: string;
  resourceId: string | null;
  sellerId: string | null;
  type: CatalogEventType;
  status: string;
  reason: string | null;
  metadata: JsonObject;
  createdAt: string;
};

export type SearchDocument = {
  id: string;
  resourceId: string;
  sellerId: string;
  body: string;
  ranking: JsonObject;
  indexedAt: string | null;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentAttempt = {
  id: string;
  correlationId: string;
  resourceId: string | null;
  sellerId: string | null;
  paymentHash: string;
  idempotencyKey: string;
  network: NetworkId;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  payTo: string;
  status: PaymentStatus;
  failureCode: string | null;
  failureReason: string | null;
  expiresAtLedger: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Settlement = {
  id: string;
  correlationId: string;
  paymentAttemptId: string;
  transactionHash: string | null;
  ledger: number | null;
  network: NetworkId;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  status: SettlementStatus;
  reconciliationState: "not_required" | "pending" | "reconciled" | "needs_review";
  reconciliationReason: string | null;
  reconciliationAttempts: number;
  lastReconciledAt: string | null;
  settledAt: string | null;
  createdAt: string;
};

export type Receipt = {
  id: string;
  correlationId: string;
  paymentAttemptId: string;
  resourceId: string | null;
  sellerId: string | null;
  transactionHash: string | null;
  ledger: number | null;
  network: NetworkId;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  status: ReceiptStatus;
  settledAt: string | null;
  failureCode: string | null;
  failureReason: string | null;
  evidenceHash: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentSession = {
  id: string;
  resourceId: string | null;
  sellerId: string | null;
  network: NetworkId;
  buyer: string;
  payTo: string;
  assetCode: string;
  assetIssuer: string;
  assetContractId: string;
  capAmount: string;
  spentAmount: string;
  remainingAmount: string;
  contractId: string;
  contractSessionId: string;
  resourceHash: string;
  expiresAtLedger: number;
  status: PaymentSessionStatus;
  transactionHash: string | null;
  ledger: number | null;
  usageHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UptoSessionSettlement = {
  id: string;
  sessionId: string;
  network: NetworkId;
  amount: string;
  transactionHash: string;
  ledger: number;
  usageHash: string;
  status: SettlementStatus;
  settledAt: string;
  createdAt: string;
};
