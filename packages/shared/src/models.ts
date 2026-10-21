import { type NetworkId } from "./networks.js";

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
export type ModerationState = "visible" | "quarantined" | "under_appeal";
export type ModerationActionType = "quarantine" | "appeal" | "restore" | "reject_appeal";
export type ModerationReasonCode =
  | "abuse"
  | "deceptive"
  | "compromised"
  | "unsafe"
  | "unsuitable"
  | "copyright"
  | "policy_violation"
  | "other";
export type ModerationResolutionCode = "appeal_upheld" | "false_positive" | "manual_restore";
export type ModerationNotificationStatus = "pending" | "notified" | "failed" | "not_required";
export type ModerationEvidenceType = "url" | "report" | "transaction" | "screenshot" | "other";
export type ResourceDiscoveryState = "discoverable" | "quarantined" | "outage" | "draft";
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
export type CatalogEventType =
  | "validated"
  | "cataloged"
  | "updated"
  | "deleted"
  | "quarantined"
  | "restored"
  | "appealed"
  | "appeal_rejected";

export type Seller = {
  id: string;
  displayName: string;
  walletAddress: string;
  domain: string;
  domainVerifiedAt: string | null;
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
  moderationState: ModerationState;
  createdAt: string;
  updatedAt: string;
};

export type ResourceVersion = {
  id: string;
  resourceId: string;
  version: number;
  metadata: JsonObject;
  moderationState: ModerationState;
  quarantineReasonCode: ModerationReasonCode | null;
  quarantinedAt: string | null;
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
  moderationState: ModerationState;
  createdAt: string;
  updatedAt: string;
};

export type ModerationEvidenceReference = {
  type: ModerationEvidenceType;
  ref: string;
  description?: string | undefined;
};

export type ResourceModerationAction = {
  id: string;
  resourceId: string;
  versionId: string;
  version: number;
  action: ModerationActionType;
  resultingState: ModerationState;
  reasonCode: ModerationReasonCode | ModerationResolutionCode;
  evidenceRefs: ModerationEvidenceReference[];
  reviewerId: string;
  reviewerType: "operator" | "seller" | "system";
  notes: string | null;
  metadata: JsonObject;
  createdAt: string;
};

export type ModerationNotification = {
  id: string;
  actionId: string;
  sellerId: string;
  resourceId: string;
  status: ModerationNotificationStatus;
  channel: string;
  notifiedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResourceModerationView = {
  resourceId: string;
  sellerId: string;
  resourceStatus: ResourceStatus;
  moderationState: ModerationState;
  discoveryState: ResourceDiscoveryState;
  latestVersion: number | null;
  quarantine: {
    version: number;
    reasonCode: ModerationReasonCode | null;
    quarantinedAt: string | null;
  } | null;
  notificationStatus: ModerationNotificationStatus | null;
  appealable: boolean;
  actions: ResourceModerationAction[];
  notifications: ModerationNotification[];
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
