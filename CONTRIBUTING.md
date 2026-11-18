# Contributing

Keep changes scoped to the application or package they affect. Protocol behavior should be covered by tests before it is exposed through public API routes.

## Local Checks

Run the full check before pushing:

```bash
pnpm check
```

Enable the repository hook and run the dependency-free malware checks before pushing:

```bash
pnpm security:install-hooks
pnpm security:malware-scan
pnpm security:malware-test
```

For database changes, validate the Prisma schema and include migration files.

## Commit Guidance

Use concise commit subjects that describe the delivered behavior. Avoid bundling unrelated formatting or refactors with protocol changes.
