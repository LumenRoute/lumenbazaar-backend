import { PrismaClient } from "@prisma/client";

let sharedClient: PrismaClient | undefined;

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  if (databaseUrl === undefined) {
    return new PrismaClient();
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl
      }
    }
  });
}

export function getPrismaClient() {
  sharedClient ??= createPrismaClient();
  return sharedClient;
}

export async function disconnectPrismaClient() {
  await sharedClient?.$disconnect();
  sharedClient = undefined;
}
