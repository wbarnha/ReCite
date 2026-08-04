/**
 * Check a build against its published checksums.
 *
 * Run against a local `dist/` after building, or against a directory holding a
 * downloaded copy of the deployed site. Exits non-zero on any mismatch, any
 * file that has appeared, and any file that has gone missing — all three mean
 * the artefact is not the one the checksums describe.
 *
 * ```
 * pnpm verify:checksums                    # the local build
 * pnpm verify:checksums path/to/downloaded # a published copy
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { IntegrityManifest } from "./shared.js";
import {
  CHECKSUM_FILE,
  DIST,
  hashTree,
  INTEGRITY_FILE,
  parseChecksumFile,
} from "./shared.js";

export interface VerificationReport {
  readonly ok: boolean;
  readonly checked: number;
  readonly mismatched: string[];
  readonly missing: string[];
  readonly unexpected: string[];
}

export function verifyTree(
  dir: string,
  expected: Record<string, string>,
): VerificationReport {
  const actual = hashTree(dir);

  const mismatched: string[] = [];
  const missing: string[] = [];

  for (const [path, digest] of Object.entries(expected)) {
    const found = actual[path];
    if (found === undefined) missing.push(path);
    else if (found !== digest) mismatched.push(path);
  }

  // A file nobody recorded is as much of a problem as a changed one: it is
  // content being served that the build did not produce.
  const unexpected = Object.keys(actual).filter((path) => !(path in expected));

  return {
    ok: mismatched.length === 0 && missing.length === 0 && unexpected.length === 0,
    checked: Object.keys(expected).length,
    mismatched,
    missing,
    unexpected,
  };
}

function main(): void {
  const dir = process.argv[2] ? process.argv[2] : DIST;

  if (!existsSync(dir)) {
    console.error(`No such directory: ${dir}\nRun \`pnpm build:release\` first.`);
    process.exit(2);
  }

  const checksumPath = join(dir, CHECKSUM_FILE);
  if (!existsSync(checksumPath)) {
    console.error(`Missing ${CHECKSUM_FILE} in ${dir}\nRun \`pnpm checksums\` first.`);
    process.exit(2);
  }

  const expected = parseChecksumFile(readFileSync(checksumPath, "utf8"));
  const report = verifyTree(dir, expected);

  const manifestPath = join(dir, INTEGRITY_FILE);
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as IntegrityManifest;
    console.log(
      `ReCite ${manifest.version}, commit ${manifest.commit.slice(0, 12)}, built ${manifest.builtAt}`,
    );
  }

  for (const path of report.mismatched) console.error(`  CHANGED  ${path}`);
  for (const path of report.missing) console.error(`  MISSING  ${path}`);
  for (const path of report.unexpected) console.error(`  EXTRA    ${path}`);

  if (report.ok) {
    console.log(`OK: ${report.checked} files match their recorded SHA-256 digests.`);
    process.exit(0);
  }

  console.error(
    `\nFAILED: ${report.mismatched.length} changed, ${report.missing.length} missing, ${report.unexpected.length} unexpected.`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
