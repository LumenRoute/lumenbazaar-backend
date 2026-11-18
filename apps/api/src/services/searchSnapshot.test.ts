import { expect, it, vi } from "vitest";
import { SearchService } from "./search.js";
import type { ResourceService } from "./resources.js";
import type { Resource } from "@lumenbazaar/shared";
const resource = (id: string) =>
  ({
    id,
    name: id,
    description: "",
    type: "http",
    network: "stellar:testnet",
    assetCode: "USDC",
    routeTemplate: "/",
    inputSchema: {},
    outputSchema: {},
    extensions: {}
  }) as Resource;
it("keeps traversal stable after changes, binds query and expires snapshots", async () => {
  vi.useFakeTimers();
  try {
    let rows = [resource("a"), resource("b"), resource("c")];
    const service = new SearchService({
      listResources: async () => ({ resources: rows, nextCursor: null })
    } as unknown as ResourceService);
    const first = await service.search({ limit: 1 });
    rows = [resource("x")];
    const second = await service.search({ limit: 2, cursor: first.nextCursor });
    expect(second.resources.map((r) => r.id)).toEqual(["b", "c"]);
    expect(second.nextCursor).toBeNull();
    await expect(service.search({ q: "changed", cursor: first.nextCursor })).rejects.toMatchObject({
      code: "VALIDATION_FAILED"
    });
    vi.advanceTimersByTime(300001);
    await expect(service.search({ cursor: first.nextCursor })).rejects.toMatchObject({
      code: "SEARCH_SNAPSHOT_EXPIRED",
      details: { restart: true }
    });
  } finally {
    vi.useRealTimers();
  }
});
it("rejects malformed cursors", async () => {
  const service = new SearchService({} as ResourceService);
  await expect(service.search({ cursor: "garbage" })).rejects.toMatchObject({
    code: "VALIDATION_FAILED"
  });
});
