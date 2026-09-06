import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import { apiOpenApiSpec, renderOpenApiMarkdown } from "../apps/api/src/openapi.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = [
  {
    path: "docs/api/openapi.json",
    parser: "json",
    source: JSON.stringify(apiOpenApiSpec)
  },
  {
    path: "docs/api/openapi.md",
    parser: "markdown",
    source: renderOpenApiMarkdown(apiOpenApiSpec)
  }
];

const checkOnly = process.argv.includes("--check");

for (const artifact of artifacts) {
  const absolutePath = resolve(root, artifact.path);
  const prettierOptions = (await resolveConfig(absolutePath)) ?? {};
  const content = await format(artifact.source, {
    ...prettierOptions,
    parser: artifact.parser
  });

  if (checkOnly) {
    const current = await readFile(absolutePath, "utf8").catch(() => "");
    if (current !== content) {
      console.error(`${artifact.path} is out of sync. Run pnpm openapi:generate.`);
      process.exitCode = 1;
    }
    continue;
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  console.log(`wrote ${artifact.path}`);
}
