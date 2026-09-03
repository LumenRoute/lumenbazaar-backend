# Security Policy

Report vulnerabilities through a private GitHub security advisory or by contacting the LumenRoute maintainers.

## Sensitive Data Rules

- Do not commit private keys, seed phrases, API tokens, wallet secrets, or production database credentials.
- Do not log raw authorization payloads when they may contain signatures or private metadata.
- Store receipts, settlement evidence, hashes, ledgers, public addresses, and public resource metadata only.
- Keep mainnet enablement behind explicit configuration and operational approval.
