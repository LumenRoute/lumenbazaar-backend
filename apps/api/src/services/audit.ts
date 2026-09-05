import { randomUUID } from "node:crypto";

import { type JsonObject, type JsonValue } from "@lumenbazaar/shared";

const sensitiveKeyPattern =
  /(secret|seed|private|token|signature|authorization|password|api[_-]?key|payment[_-]?payload)/i;

export type AuditLogInput = {
  action: string;
  actorId?: string | null;
  actorType: "buyer" | "facilitator" | "seller" | "system";
  metadata?: Record<string, unknown>;
  targetId?: string | null;
  targetType: string;
};

export type AuditLogRecord = {
  action: string;
  actorId: string | null;
  actorType: AuditLogInput["actorType"];
  createdAt: string;
  id: string;
  metadata: JsonObject;
  targetId: string | null;
  targetType: string;
};

export type AuditLogStore = {
  create: (input: Omit<AuditLogRecord, "id" | "createdAt">) => Promise<AuditLogRecord>;
  list: () => Promise<AuditLogRecord[]>;
};

export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly records: AuditLogRecord[] = [];

  async create(input: Omit<AuditLogRecord, "id" | "createdAt">) {
    const record: AuditLogRecord = {
      id: `audit_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      ...input,
      createdAt: new Date().toISOString()
    };

    this.records.push(record);
    return record;
  }

  async list() {
    return [...this.records];
  }
}

export class AuditLogService {
  constructor(private readonly store: AuditLogStore = new InMemoryAuditLogStore()) {}

  async record(input: AuditLogInput) {
    return this.store.create({
      action: input.action,
      actorId: input.actorId ?? null,
      actorType: input.actorType,
      metadata: sanitizeAuditMetadata(input.metadata ?? {}),
      targetId: input.targetId ?? null,
      targetType: input.targetType
    });
  }

  async list() {
    return this.store.list();
  }
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : toJsonValue(value)
    ])
  ) as JsonObject;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === "object") {
    return sanitizeAuditMetadata(value as Record<string, unknown>);
  }

  return String(value);
}
