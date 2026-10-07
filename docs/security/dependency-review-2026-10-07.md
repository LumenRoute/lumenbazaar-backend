# Production Dependency Review - 2026-10-07

## Result

`pnpm audit --prod` reports no known vulnerabilities after the reviewed upgrades. CI runs `pnpm audit --prod --audit-level high` after the complete application check.

| Path                                 | Resolution                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fastify request handling             | Upgraded `fastify` from 5.12.1 to 5.12.5 and `@fastify/cors` from 11.1.0 to 11.3.0.                                                                          |
| MCP transport                        | Upgraded `@modelcontextprotocol/sdk` to 1.32.1, which removes its SDK advisory; refreshed `proxy-addr`, Hono, and related transitives to patched releases.   |
| Stellar HTTP client                  | Upgraded the direct Stellar SDK to 17.2.1 and `@x402/stellar` to 2.28.0. Axios resolves to 1.20.0 and `smol-toml` to 1.9.0.                                  |
| Prisma configuration                 | Prisma 6.19.3 is the latest 6.x release, so `deepmerge-ts` is overridden to patched 8.0.0. Prisma generation and validation exercise the compatibility path. |
| Fastify validation and rate limiting | Refreshed `fast-uri` to 3.1.8/4.2.1 and `ip-address` to 10.7.3 within parent ranges.                                                                         |

The Axios override is required because `@x402/stellar` 2.28.0 depends on Stellar SDK 16.3.0, which pins Axios 1.18.0 exactly. The root also uses Stellar SDK 17.2.1. Both paths resolve to reviewed Axios 1.20.0 and are covered by the Stellar adapter and HTTP tests. Remove the override when `@x402/stellar` adopts a Stellar SDK release with patched Axios, or re-review it by 2026-11-07.

The `deepmerge-ts` override must be removed during the Prisma 7 migration or re-reviewed by 2026-11-07. No advisory is ignored: both overrides resolve the vulnerable package to its patched release.

## Reachability Review

- Fastify proxy trust is explicitly disabled. Forwarded client addresses cannot split rate-limit buckets.
- MCP request routing uses only origin-form request targets and a fixed parsing base. It rejects absolute, protocol-relative, backslash-containing, and control-character request targets without consulting the `Host` header.
- Header names are consumed through Node/Fastify normalized lower-case access. A mixed-case API key regression test shares the same rate-limit bucket.
- Boolean environment parsing preserves explicit `false` and `0`; malformed values fail schema validation.
- The MCP service registers no OAuth metadata or redirect endpoint. Well-known OAuth metadata requests return 404 without a `Location` header.
- CORS origins must be exact HTTP(S) origins. Wildcards and malformed URLs fail configuration validation.
