# MCP OAuth protection

Public MCP deployments validate OAuth access tokens and publish RFC 9728 protected-resource metadata.

## Configuration

| Variable | Meaning |
| --- | --- |
| `MCP_OAUTH_ENABLED` | `true` to require tokens. When true, all values below are required; startup fails otherwise |
| `MCP_RESOURCE_URL` | Canonical URL of this MCP server. Tokens must carry exactly this value as `aud` |
| `MCP_AUTHORIZATION_SERVER` | The single trusted issuer. Must equal the token `iss` exactly |
| `MCP_JWKS_URI` | Where the issuer's signing keys are published |
| `MCP_SCOPES_SUPPORTED` | Space or comma separated scopes advertised in metadata |

URLs must use https (http only for localhost). Values are compared as exact strings.

## Metadata

`GET /.well-known/oauth-protected-resource[/<resource path>]` returns the resource, exactly one authorization server and the supported scopes. Values come from configuration, never from request headers.

## Token rules

A token is accepted only if it has a valid signature from the published keys (RS256, ES256 or EdDSA), the expected `iss`, **exactly one** audience equal to `MCP_RESOURCE_URL`, `sub`, and a non-expired `exp`. Tokens minted for the backend API or another MCP server are rejected, including multi-audience tokens. Tokens are read from the `Authorization: Bearer` header only.

## Tool scopes

Each tool requires a scope, checked before the tool runs. A missing scope returns `403` with `insufficient_scope`. Tools without a scope mapping are denied.

## Errors

`401` with `WWW-Authenticate: Bearer resource_metadata="..."` for missing or invalid tokens; `403` for missing scope.