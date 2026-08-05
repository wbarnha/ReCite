/**
 * Stamp the resolved release version into every `package.json`.
 *
 * The npm packages carry a three-part semver, so they get the tag as-is; the
 * Office manifest and the build metadata are generated at build time and read
 * the resolver directly, so nothing needs writing for those.
 *
 * This runs in the release workflow, against a checkout of the tag. It does
 * not commit: the tag is the record of what was released, and a build that
 * rewrote history to agree with itself would prove nothing. The working tree
 * is modified only so that `pnpm pack` produces a tarball with the right
 * number in it.
 *
 * `--check` reports what would change and exits non-zero if anything would,
 * without writing. That is the form to run against a release before trusting
 * the artefacts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ReleaseVersion } from "./resolve.js";
import { prereleaseWarning, resolveVersion } from "./resolve.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/**
 * Every manifest that carries a version.
 *
 * Listed rather than globbed. A glob would silently pick up a `package.json`
 * inside a fixture or a `node_modules` that escaped the ignore rules, and
 * rewriting one of those is worse than missing it.
 */
const MANIFESTS = [
  "package.json",
  "packages/core/package.json",
  "packages/rules/package.json",
  "packages/engine/package.json",
  "apps/web/package.json",
] as const;

interface Change {
  readonly path: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Replace the `version` field textually rather than by re-serialising.
 *
 * `JSON.parse` then `JSON.stringify` would reformat the whole file and reorder
 * nothing but still produce a diff touching every line, which makes a release
 * commit impossible to read. The field is always at the top level and always a
 * string, so a narrow substitution is both sufficient and honest about what it
 * changed.
 */
function replaceVersion(contents: string, next: string): string {
  const pattern = /^(\s*"version"\s*:\s*)"[^"]*"/m;
  if (!pattern.test(contents)) {
    throw new Error("no top-level `version` field found");
  }
  return contents.replace(pattern, `$1${JSON.stringify(next)}`);
}

function currentVersion(contents: string): string {
  const match = /^\s*"version"\s*:\s*"([^"]*)"/m.exec(contents);
  if (!match?.[1]) throw new Error("no top-level `version` field found");
  return match[1];
}

export function planChanges(version: ReleaseVersion, root: string = ROOT): Change[] {
  const changes: Change[] = [];

  for (const relative of MANIFESTS) {
    const path = join(root, relative);
    let contents: string;
    try {
      contents = readFileSync(path, "utf8");
    } catch {
      throw new Error(`${relative}: not found`);
    }

    let from: string;
    try {
      from = currentVersion(contents);
    } catch (error) {
      throw new Error(`${relative}: ${(error as Error).message}`);
    }

    if (from !== version.semver) {
      changes.push({ path: relative, from, to: version.semver });
    }
  }

  return changes;
}

function write(changes: readonly Change[], root: string): void {
  for (const change of changes) {
    const path = join(root, change.path);
    writeFileSync(path, replaceVersion(readFileSync(path, "utf8"), change.to), "utf8");
  }
}

function main(): void {
  const checkOnly = process.argv.includes("--check");
  const version = resolveVersion();
  const warning = prereleaseWarning(version);

  console.log(`Release version ${version.semver} (${version.source})`);
  console.log(`  npm packages:   ${version.semver}`);
  console.log(`  Office manifest: ${version.product}`);

  if (warning) {
    console.warn(`\nwarning: ${warning}`);
    if (process.env.GITHUB_ACTIONS) console.warn(`::warning::${warning}`);
  }

  const changes = planChanges(version, ROOT);

  if (changes.length === 0) {
    console.log("\nEvery package.json already matches.");
    return;
  }

  console.log("");
  for (const change of changes) {
    console.log(`  ${change.path}: ${change.from} -> ${change.to}`);
  }

  if (checkOnly) {
    console.error(
      `\n${changes.length} file(s) do not match the release version. ` +
        "Run `pnpm version:apply`.",
    );
    process.exit(1);
  }

  write(changes, ROOT);
  console.log(`\nUpdated ${changes.length} file(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
