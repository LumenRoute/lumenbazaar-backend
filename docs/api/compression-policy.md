# API Response Compression Safety Policy

## Overview

The API implements size, content-type, and sensitivity-aware compression rules with documented exclusions to prevent CPU exhaustion, cache poisoning (BREACH), and exposure of sensitive data.

**Key Principle**: Compress only safe, large, text-like payloads. Fail-closed: when in doubt, do not compress.

## Compression Decision Logic

A response is compressed **only** when ALL of the following are true:

1. ✓ Compression globally enabled
2. ✓ Client sends `Accept-Encoding` header (with gzip, deflate, or br)
3. ✓ Response is NOT already encoded
4. ✓ Response size >= minimum threshold (1 KB by default)
5. ✓ Response size <= maximum threshold (10 MB by default)
6. ✓ Content-Type is in allowlist
7. ✓ Content-Type is not already compressed (image/*, audio/*, video/*, etc.)
8. ✓ Path is NOT in sensitive exclusion list
9. ✓ HTTP method is GET, POST, PATCH, or PUT (not HEAD, DELETE)
10. ✓ Status code is 2xx-5xx (not 204, 304)

If any condition is false, the response is sent **uncompressed**.

## Configuration

### Default Thresholds

```json
{
  "enabled": true,
  "minSizeBytes": 1024,
  "maxSizeBytes": 10485760,
  "compressionLevel": 6,
  "allowedContentTypes": [
    "application/json",
    "text/plain",
    "text/html",
    "text/javascript",
    "text/css",
    "text/xml",
    "application/xml"
  ]
}
```

### Environment Variables

```bash
API_COMPRESSION_ENABLED=true           # Enable/disable (default: true)
API_COMPRESSION_MIN_SIZE_BYTES=1024    # Min size (default: 1024)
API_COMPRESSION_MAX_SIZE_BYTES=10485760 # Max size (default: 10 MB)
API_COMPRESSION_LEVEL=6                # Compression level 1-9 (default: 6)
```

## Sensitive Paths (Never Compressed)

The following endpoint patterns are **always excluded** from compression (BREACH protection):

```
/v1/sellers/login              # Auth token risks
/v1/sellers/token             # Auth token risks
/v1/sellers/*/apikeys         # API keys
/v1/facilitator/verify        # Payment verification (PII + secrets)
/v1/facilitator/settle        # Settlement data (money + secrets)
/v1/receipts/*                # Settlement receipts
/v1/settlements/*             # Settlement records
/v1/sellers/*                 # Seller account data (user-specific)
/v1/sellers/*/webhooks        # Webhook configuration
```

**Why**: These endpoints mix attacker-influenced data (paymentHash, ledger info) with secrets (keys, tokens). Compression can leak secrets via BREACH-like attacks by revealing payload size patterns.

## Response Headers

When compression is applied:

```http
Content-Encoding: gzip
Vary: Accept-Encoding
Content-Length: <compressed-size>
```

**Important**:
- `Vary: Accept-Encoding` tells caches not to serve the compressed version to clients that don't support it
- `Content-Length` is updated to compressed size
- `Content-Encoding` indicates the encoding used

## Supported Encodings (in preference order)

1. **gzip** (most common, best browser support)
2. **deflate** (fallback)
3. **br** (Brotli, if available in Node.js)
4. **compress** (legacy LZW, falls back to deflate)
5. **identity** (no compression, explicit client preference)

## Examples

### ✓ Compressed: Normal GET Request

```http
GET /v1/resources HTTP/1.1
Accept-Encoding: gzip, deflate

HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 2048
Content-Encoding: gzip
Vary: Accept-Encoding

[compressed payload]
```

**Decision**: Compressed because:
- Size 2048 bytes (> 1 KB min, < 10 MB max)
- Content-Type "application/json" is allowlisted
- Path "/v1/resources" is not sensitive
- Client accepts gzip

### ✗ Not Compressed: Sensitive Auth Endpoint

```http
POST /v1/sellers/token HTTP/1.1
Accept-Encoding: gzip
Content-Type: application/json

{"clientId": "...", "secret": "..."}

HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 512

{"token": "eyJhbGc...", "expires": "2024-01-01T..."}
```

**Decision**: NOT compressed because:
- Path "/v1/sellers/token" is in sensitive exclusion list (BREACH protection)
- Even though size and content-type would otherwise allow it

### ✗ Not Compressed: Small Response

```http
GET /v1/health HTTP/1.1
Accept-Encoding: gzip

HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 24

{"status":"ok"}
```

**Decision**: NOT compressed because:
- Response size 24 bytes < 1 KB minimum threshold
- Compression overhead would be larger than uncompressed

### ✗ Not Compressed: Image Response

```http
GET /v1/resources/icon.png HTTP/1.1
Accept-Encoding: gzip

HTTP/1.1 200 OK
Content-Type: image/png
Content-Length: 8192

[binary PNG data]
```

**Decision**: NOT compressed because:
- Content-Type "image/png" is not in allowlist
- Binary formats are already compressed or not compressible

### ✗ Not Compressed: No Accept-Encoding

```http
GET /v1/resources HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 2048

[uncompressed payload]
```

**Decision**: NOT compressed because:
- No Accept-Encoding header (client doesn't support compression)

## Performance Notes

### CPU Impact

- Compression level 6 (default) balances speed and ratio
- Compression takes CPU time; benefit only if transfer time reduction > CPU cost
- Minimum 1 KB threshold prevents overhead on small responses
- Maximum 10 MB threshold prevents memory/CPU exhaustion on huge payloads

### Bandwidth Savings

Typical JSON compression ratios at level 6:
- Verbose schemas: 70-80% reduction
- Structured data: 50-70% reduction
- Already-compact JSON: 20-40% reduction

**Example**:
- Uncompressed: 5 MB
- Compressed (gzip-6): ~1-2 MB
- Savings: 60-80%

### When NOT to Enable

- Internal APIs (no bandwidth constraint)
- Real-time protocols (latency > bandwidth)
- Embedded systems with CPU constraints

## Security Considerations

### BREACH Protection

The sensitive path exclusion list protects against BREACH-like attacks:
- Attacker mixes known data (paymentHash, ledger, timestamp) with secrets
- Compression reduces size when secret matches guess
- Attacker infers the secret from size reduction pattern

**Mitigation**: Don't compress endpoints where both attacker-controlled input and secrets are present in the same response.

### Already-Compressed Formats

Never double-compress:
- Content-Encoding header prevents re-compression
- Binary formats (images, archives) are skipped
- Already-gzipped content is skipped

### Cache Coherence

The `Vary: Accept-Encoding` header ensures:
- Compressed version not served to clients that can't decompress
- Intermediate caches respect Accept-Encoding preferences
- CDNs and proxies handle variants correctly

## Testing

### Unit Tests

```bash
pnpm test -- compressionPolicy.test.ts
```

Covers:
- Size boundaries (minimum, maximum)
- Content-type allowlist
- Sensitive path patterns
- Encoding negotiation
- Configuration validation

### Integration Tests

1. Enable compression
2. Make requests to various endpoints
3. Verify `Content-Encoding` header present when expected
4. Decompress and verify payload matches original
5. Monitor CPU usage

### Load Test

```bash
pnpm load:test
```

Includes scenarios:
- Large JSON payload (compressed vs uncompressed)
- Small payload (compare overhead)
- Sensitive endpoint (verify no compression)

## Operations

### Enabling Compression

Already enabled by default. To verify:

```bash
curl -H "Accept-Encoding: gzip" https://api.example.com/v1/resources \
  | gunzip | jq .
```

Expected:
- Response has `Content-Encoding: gzip` header
- Body is binary (gzipped)
- gunzip decompresses correctly

### Disabling Compression

```bash
export API_COMPRESSION_ENABLED=false
```

### Changing Thresholds

```bash
export API_COMPRESSION_MIN_SIZE_BYTES=2048  # 2 KB minimum
export API_COMPRESSION_MAX_SIZE_BYTES=5242880  # 5 MB maximum
```

### Monitoring

Track:
- Compression ratio per endpoint
- CPU usage during compression
- Bandwidth savings
- Cache hit rates (with/without compression)

## Troubleshooting

### "Compressed response decompresses to different content"

→ Compression bug or corrupt transport
→ Run tests: `pnpm test -- compressionPolicy.test.ts`
→ Check Content-Length matches actual payload

### "Auth endpoint response is compressed despite sensitivity rules"

→ Check path pattern matches exactly (wildcards, case sensitivity)
→ Verify sensitivePathPatterns includes the endpoint
→ Re-run with `API_COMPRESSION_ENABLED=false` to confirm

### "Large responses not compressed (hit max-size limit)"

→ Increase API_COMPRESSION_MAX_SIZE_BYTES if safe
→ Consider pagination to keep payloads under 10 MB
→ Verify Content-Length header is accurate

### "CPU usage high after enabling compression"

→ Lower API_COMPRESSION_LEVEL (e.g., 4 or 3)
→ Increase API_COMPRESSION_MIN_SIZE_BYTES to skip small responses
→ Monitor compression benefit (may not justify CPU cost)

## References

- [RFC 7231: HTTP Semantics - Content-Encoding](https://tools.ietf.org/html/rfc7231#section-3.1.2.2)
- [BREACH Attack](https://en.wikipedia.org/wiki/BREACH)
- [OWASP: HTTP Compression](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/10-Testing_for_HTTP_Compression)
- [Node.js Compression Module](https://nodejs.org/api/zlib.html)
