/**
 * The revision string baked into the generated reporter table.
 *
 * Read out of the file as text rather than imported: this suite belongs to the
 * build tooling, which does not reference the `@recite/core` project, and
 * pulling core's types in just to read one constant would tie the two together
 * for no benefit.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(
  HERE,
  "..",
  "..",
  "..",
  "packages",
  "core",
  "src",
  "data",
  "upstream.generated.ts",
);

export function readGeneratedRevision(): string | undefined {
  const source = readFileSync(GENERATED, "utf8");
  return /export const UPSTREAM_REVISION = "([^"]+)"/.exec(source)?.[1];
}
