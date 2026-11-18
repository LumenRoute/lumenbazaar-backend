import { LumenError } from "./errors.js";

/** HTTPS only; preserve path case, trailing slash and escaped reserved separators. */
export function canonicalResourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LumenError("CATALOG_VALIDATION_FAILED", "Invalid resource URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%(?![0-9a-f]{2})/i.test(value)
  ) {
    throw new LumenError(
      "CATALOG_VALIDATION_FAILED",
      "Resource URL must be HTTPS without credentials, query or fragment."
    );
  }
  url.pathname = url.pathname.replace(/%[0-9a-f]{2}/gi, (escape) => {
    const char = String.fromCharCode(parseInt(escape.slice(1), 16));
    return /[a-z0-9._~-]/i.test(char) ? char : escape.toUpperCase();
  });
  return url.href;
}
