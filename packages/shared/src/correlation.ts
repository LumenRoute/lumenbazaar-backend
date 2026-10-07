import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const correlationIds = new AsyncLocalStorage<string>();

export function createCorrelationId() {
  return `corr_${randomUUID().replaceAll("-", "")}`;
}

export function getCorrelationId() {
  return correlationIds.getStore();
}

export function runWithCorrelationId<T>(correlationId: string, callback: () => T) {
  return correlationIds.run(correlationId, callback);
}
