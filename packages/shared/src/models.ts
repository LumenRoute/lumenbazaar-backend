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
export type PaymentScheme = "exact" | "upto";
export type PaymentStatus = "received" | "verified" | "settled" | "failed";
export type SettlementStatus = "pending" | "settled" | "failed";
export type ReceiptStatus = "pending" | "finalized" | "failed";
export type CatalogEventType = "validated" | "cataloged" | "updated" | "deleted";

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
  createdAt: string;
  updatedAt: string;
};

export type ResourceVersion = {
  id: string;
  resourceId: string;
  version: number;
  metadata: JsonObject;
  createdAt: string;
};

export type PaymentAttempt = {
  id: string;
  resourceId: string | null;
  sellerId: string | null;
  paymentHash: string;
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
  paymentAttemptId: string;
  transactionHash: string | null;
  ledger: number | null;
  network: NetworkId;
  amount: string;
  assetCode: string;
  assetIssuer: string;
  status: SettlementStatus;
  settledAt: string | null;
  createdAt: string;
};

export type Receipt = {
  id: string;
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
  createdAt: string;
  updatedAt: string;
};
