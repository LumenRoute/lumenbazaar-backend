import { createPrismaClient, type AppConfig } from "@lumenbazaar/shared";

import { InMemoryPaymentAttemptStore, type PaymentAttemptStore } from "./paymentAttemptStore.js";
import { type PaymentStatePersistence } from "./paymentStatePersistence.js";
import {
  PrismaPaymentAttemptStore,
  PrismaPaymentStatePersistence,
  PrismaReceiptStore,
  PrismaSettlementStore
} from "./prismaPaymentPersistence.js";
import { InMemoryReceiptStore, type ReceiptStore } from "./receiptStore.js";
import { InMemorySettlementStore, type SettlementStore } from "./settlementStore.js";

export type PaymentPersistenceBundle = {
  attemptStore: PaymentAttemptStore;
  settlementStore: SettlementStore;
  receiptStore: ReceiptStore;
  statePersistence?: PaymentStatePersistence;
  close: () => Promise<void>;
};

export function createPaymentPersistence(config: AppConfig): PaymentPersistenceBundle {
  if (config.nodeEnv !== "production" || config.lumenEnv === "local") {
    return {
      attemptStore: new InMemoryPaymentAttemptStore(),
      settlementStore: new InMemorySettlementStore(),
      receiptStore: new InMemoryReceiptStore(),
      close: async () => undefined
    };
  }

  const client = createPrismaClient(config.databaseUrl);
  return {
    attemptStore: new PrismaPaymentAttemptStore(client),
    settlementStore: new PrismaSettlementStore(client),
    receiptStore: new PrismaReceiptStore(client),
    statePersistence: new PrismaPaymentStatePersistence(client),
    close: async () => client.$disconnect()
  };
}
