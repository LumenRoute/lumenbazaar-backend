export function createTestDatabaseUrl(name: string) {
  const safeName = name.replaceAll(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  return `postgresql://postgres:postgres@localhost:5432/${safeName}`;
}

export const defaultTestDatabaseUrl = createTestDatabaseUrl("lumenbazaar_test");
