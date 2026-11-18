import { PrismaClient } from "@prisma/client";
import { canonicalResourceUrl } from "@lumenbazaar/shared";
const db = new PrismaClient();
try {
  const rows = await db.resource.findMany({ select: { id: true, url: true, sellerId: true } });
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    try {
      const canonical = canonicalResourceUrl(row.url);
      const key = JSON.stringify([row.sellerId, canonical]);
      groups.set(key, [...(groups.get(key) ?? []), row.id]);
      if (canonical !== row.url)
        console.log(JSON.stringify({ id: row.id, requiresNormalization: true }));
    } catch {
      console.log(JSON.stringify({ id: row.id, invalid: true }));
    }
  }
  for (const ids of groups.values())
    if (ids.length > 1) console.log(JSON.stringify({ collisionIds: ids }));
} finally {
  await db.$disconnect();
}
