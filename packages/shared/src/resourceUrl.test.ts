import { expect, it } from "vitest";
import { canonicalResourceUrl } from "./resourceUrl.js";
it("canonicalizes host, default port, dot segments and unreserved escapes", () => {
  expect(canonicalResourceUrl("https://EXAMPLE.com:443/a/../%7euser/%2f")).toBe(
    "https://example.com/~user/%2F"
  );
  expect(canonicalResourceUrl("https://example.com/A/")).not.toBe(
    canonicalResourceUrl("https://example.com/a")
  );
});
it("rejects unsupported schemes, credentials and malformed encoding", () => {
  for (const url of [
    "http://example.com",
    "file:///a",
    "https://a:b@example.com",
    "https://example.com/%zz",
    "https://example.com/?token=x"
  ])
    expect(() => canonicalResourceUrl(url)).toThrow();
});
