import { describe, it, expect } from 'vitest'
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose'
import {
  McpAuthError,
  extractBearerToken,
  loadMcpOAuthConfig,
  metadataUrl,
  protectedResourceMetadata,
  requireToolScope,
  verifyAccessToken,
  wwwAuthenticate,
  type McpOAuthConfig,
} from '../src/oauth.js'

const cfg: McpOAuthConfig = {
  resource: 'https://mcp.example.test/mcp',
  authorizationServer: 'https://auth.example.test',
  jwksUri: 'https://auth.example.test/jwks',
  scopesSupported: ['mcp:read', 'mcp:write'],
}

async function makeKey(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }
  return { privateKey, jwk, kid }
}

async function sign(
  key: Awaited<ReturnType<typeof makeKey>>,
  opts: { iss?: string; aud?: string | string[]; scope?: string; exp?: string | null; sub?: string } = {},
) {
  let jwt = new SignJWT({ scope: opts.scope ?? 'mcp:read' })
    .setProtectedHeader({ alg: 'ES256', kid: key.kid })
    .setIssuer(opts.iss ?? cfg.authorizationServer)
    .setAudience(opts.aud ?? cfg.resource)
    .setSubject(opts.sub ?? 'user-1')
    .setIssuedAt()
  if (opts.exp !== null) jwt = jwt.setExpirationTime(opts.exp ?? '5m')
  return jwt.sign(key.privateKey)
}

async function setup() {
  const current = await makeKey('current')
  const getKey = createLocalJWKSet({ keys: [current.jwk] })
  return { current, getKey }
}

describe('verifyAccessToken', () => {
  it('accepts a valid token for this resource', async () => {
    const { current, getKey } = await setup()
    const result = await verifyAccessToken(await sign(current), cfg, getKey)
    expect(result.subject).toBe('user-1')
    expect(result.scopes.has('mcp:read')).toBe(true)
  })

  it('rejects a token issued for the backend API (confused deputy)', async () => {
    const { current, getKey } = await setup()
    const token = await sign(current, { aud: 'https://api.example.test' })
    await expect(verifyAccessToken(token, cfg, getKey)).rejects.toMatchObject({ code: 'invalid_token', status: 401 })
  })

  it('rejects a token issued for another MCP server', async () => {
    const { current, getKey } = await setup()
    const token = await sign(current, { aud: 'https://other-mcp.example.test/mcp' })
    await expect(verifyAccessToken(token, cfg, getKey)).rejects.toBeInstanceOf(McpAuthError)
  })

  it('rejects a multi-audience token that also names another resource', async () => {
    const { current, getKey } = await setup()
    const token = await sign(current, { aud: [cfg.resource, 'https://api.example.test'] })
    await expect(verifyAccessToken(token, cfg, getKey)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('rejects a token from a substituted authorization server', async () => {
    const { current, getKey } = await setup()
    const token = await sign(current, { iss: 'https://evil-auth.example.test' })
    await expect(verifyAccessToken(token, cfg, getKey)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('rejects an expired token', async () => {
    const { current, getKey } = await setup()
    const token = await sign(current, { exp: '-10m' })
    await expect(verifyAccessToken(token, cfg, getKey)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('rejects a token with no expiry', async () => {
    const { current, getKey } = await setup()
    const token = await sign(current, { exp: null })
    await expect(verifyAccessToken(token, cfg, getKey)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('rejects a token signed by a stale / rotated-out key', async () => {
    const { getKey } = await setup()                 // JWKS only has "current"
    const stale = await makeKey('retired')           // signing key no longer published
    const token = await sign(stale)
    await expect(verifyAccessToken(token, cfg, getKey)).rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('rejects an HS256 token (algorithm confusion)', async () => {
    const { getKey } = await setup()
    const token = await new SignJWT({ scope: 'mcp:read' })
      .setProtectedHeader({ alg: 'HS256', kid: 'current' })
      .setIssuer(cfg.authorizationServer)
      .setAudience(cfg.resource)
      .setSubject('user-1')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(32)))
    await expect(verifyAccessToken(token, cfg, getKey)).rejects.toMatchObject({ code: 'invalid_token' })
  })
})

describe('tool scopes', () => {
  const toolScopes = { search: 'mcp:read', write_thing: 'mcp:write' }

  it('allows a tool when the scope is granted', () => {
    expect(() => requireToolScope('search', new Set(['mcp:read']), toolScopes)).not.toThrow()
  })

  it('rejects with 403 insufficient_scope when the scope is missing', () => {
    try {
      requireToolScope('write_thing', new Set(['mcp:read']), toolScopes)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(McpAuthError)
      expect((e as McpAuthError).status).toBe(403)
      expect((e as McpAuthError).code).toBe('insufficient_scope')
      expect((e as McpAuthError).scope).toBe('mcp:write')
    }
  })

  it('fails closed for unmapped tools', () => {
    expect(() => requireToolScope('unknown_tool', new Set(['mcp:read', 'mcp:write']), toolScopes)).toThrow(McpAuthError)
  })
})

describe('protected resource metadata', () => {
  it('names exactly one resource and one authorization server', () => {
    const meta = protectedResourceMetadata(cfg)
    expect(meta.resource).toBe(cfg.resource)
    expect(meta.authorization_servers).toEqual([cfg.authorizationServer])
  })

  it('metadata URL and challenge come from config, not request data', () => {
    expect(metadataUrl(cfg)).toBe('https://mcp.example.test/.well-known/oauth-protected-resource/mcp')
    expect(wwwAuthenticate(cfg)).toBe(
      'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
    )
  })
})

describe('config + header parsing', () => {
  it('is disabled unless MCP_OAUTH_ENABLED=true', () => {
    expect(loadMcpOAuthConfig({})).toBeNull()
  })

  it('fails closed on missing or insecure values', () => {
    expect(() => loadMcpOAuthConfig({ MCP_OAUTH_ENABLED: 'true' })).toThrow(/MCP_RESOURCE_URL/)
    expect(() =>
      loadMcpOAuthConfig({
        MCP_OAUTH_ENABLED: 'true',
        MCP_RESOURCE_URL: 'http://mcp.example.test/mcp',
        MCP_AUTHORIZATION_SERVER: 'https://auth.example.test',
        MCP_JWKS_URI: 'https://auth.example.test/jwks',
      }),
    ).toThrow(/https/)
  })

  it('only accepts well-formed Authorization: Bearer headers', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(extractBearerToken('Basic abc')).toBeNull()
    expect(extractBearerToken('Bearer a b')).toBeNull()
    expect(extractBearerToken(undefined)).toBeNull()
  })
})