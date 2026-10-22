import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'

export interface McpOAuthConfig {
  /** Canonical URI of THIS MCP server. Tokens must be issued for exactly this audience. */
  resource: string
  /** The single trusted authorization server (token `iss`). */
  authorizationServer: string
  jwksUri: string
  scopesSupported: string[]
  clockToleranceSeconds?: number
}

export type McpAuthErrorCode = 'invalid_token' | 'insufficient_scope'

export class McpAuthError extends Error {
  constructor(
    public readonly code: McpAuthErrorCode,
    public readonly status: 401 | 403,
    message: string,
    public readonly scope?: string,
  ) {
    super(message)
    this.name = 'McpAuthError'
  }
}

export interface VerifiedToken {
  subject: string
  scopes: Set<string>
  expiresAt: number
}

function requireUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required when MCP_OAUTH_ENABLED=true`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute URL`)
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error(`${name} must use https`)
  }
  if (url.hash) throw new Error(`${name} must not contain a fragment`)
  return value
}

/** Returns null when OAuth is disabled. Throws (fail closed) on partial or invalid config. */
export function loadMcpOAuthConfig(env: Record<string, string | undefined>): McpOAuthConfig | null {
  if (env.MCP_OAUTH_ENABLED !== 'true') return null
  const scopesSupported = (env.MCP_SCOPES_SUPPORTED ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    resource: requireUrl(env.MCP_RESOURCE_URL, 'MCP_RESOURCE_URL'),
    authorizationServer: requireUrl(env.MCP_AUTHORIZATION_SERVER, 'MCP_AUTHORIZATION_SERVER'),
    jwksUri: requireUrl(env.MCP_JWKS_URI, 'MCP_JWKS_URI'),
    scopesSupported,
  }
}

export function createJwksResolver(cfg: McpOAuthConfig): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(cfg.jwksUri), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  })
}

/** Extracts a bearer token from the Authorization header ONLY (never from query strings). */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(header)
  return match ? (match[1] as string) : null
}

export function parseScopes(payload: JWTPayload): Set<string> {
  const scopes = new Set<string>()
  if (typeof payload.scope === 'string') {
    for (const s of payload.scope.split(' ')) if (s) scopes.add(s)
  }
  if (Array.isArray(payload.scp)) {
    for (const s of payload.scp) if (typeof s === 'string' && s) scopes.add(s)
  }
  return scopes
}

export async function verifyAccessToken(
  token: string,
  cfg: McpOAuthConfig,
  getKey: JWTVerifyGetKey,
): Promise<VerifiedToken> {
  let payload: JWTPayload
  try {
    const result = await jwtVerify(token, getKey, {
      issuer: cfg.authorizationServer,
      audience: cfg.resource,
      algorithms: ['RS256', 'ES256', 'EdDSA'],
      clockTolerance: cfg.clockToleranceSeconds ?? 30,
      requiredClaims: ['exp', 'iss', 'aud', 'sub'],
    })
    payload = result.payload
  } catch {
    // Do not leak why (expired, wrong key, wrong issuer...) to the caller.
    throw new McpAuthError('invalid_token', 401, 'Token validation failed')
  }

  // Confused-deputy guard: the token must be minted for this resource ONLY.
  // A token that also lists the backend API or another MCP server is rejected.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (audiences.length !== 1 || audiences[0] !== cfg.resource) {
    throw new McpAuthError('invalid_token', 401, 'Token audience is not this resource')
  }

  return {
    subject: payload.sub as string,
    scopes: parseScopes(payload),
    expiresAt: payload.exp as number,
  }
}

/**
 * Scope required to call each tool. REPLACE the keys with the real tool names
 * from server.ts. Unmapped tools are denied (fail closed).
 */
export const TOOL_SCOPES: Record<string, string> = {
  // 'search_bazaar': 'mcp:read',
  // 'get_receipt': 'mcp:read',
}

export function requireToolScope(
  toolName: string,
  granted: Set<string>,
  toolScopes: Record<string, string> = TOOL_SCOPES,
): void {
  const needed = toolScopes[toolName]
  if (!needed) throw new McpAuthError('insufficient_scope', 403, 'Tool has no scope mapping')
  if (!granted.has(needed)) {
    throw new McpAuthError('insufficient_scope', 403, 'Missing required scope', needed)
  }
}

/** RFC 9728 metadata. Everything comes from config, never from request headers. */
export function protectedResourceMetadata(cfg: McpOAuthConfig) {
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.authorizationServer],
    scopes_supported: cfg.scopesSupported,
    bearer_methods_supported: ['header'],
  }
}

export function metadataPath(cfg: McpOAuthConfig): string {
  const { pathname } = new URL(cfg.resource)
  const suffix = pathname === '/' ? '' : pathname.replace(/\/$/, '')
  return `/.well-known/oauth-protected-resource${suffix}`
}

export function metadataUrl(cfg: McpOAuthConfig): string {
  return `${new URL(cfg.resource).origin}${metadataPath(cfg)}`
}

export function wwwAuthenticate(cfg: McpOAuthConfig, err?: McpAuthError): string {
  const parts = [`resource_metadata="${metadataUrl(cfg)}"`]
  if (err) {
    parts.push(`error="${err.code}"`)
    if (err.scope) parts.push(`scope="${err.scope}"`)
  }
  return `Bearer ${parts.join(', ')}`
}