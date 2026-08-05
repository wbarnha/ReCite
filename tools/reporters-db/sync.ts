/**
 * Pull the reporter table from upstream and regenerate the vendored data.
 *
 * ```console
 * $ pnpm reporters:sync                 # re-verify and regenerate at the pin
 * $ pnpm reporters:sync --ref v3.2.70   # move to a new upstream tag
 * $ pnpm reporters:sync --dry-run       # show what would change
 * ```
 *
 * The output is committed. Nothing fetches at build time and nothing fetches
 * in the browser — the whole point of vendoring is that ReCite's findings
 * depend on a revision someone chose, not on what upstream happens to be
 * serving during a deploy.
 *
 * Moving the pin is a reviewable change on purpose. Upstream owns the dates
 * that decide whether `999 F.3d 1 (1950)` is impossible, so a diff that
 * changes a date range changes what ReCite tells a lawyer about their brief.
 * The summary printed here is meant to be read.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pin } from "./fetch.js";
import { fetchPinned, readPin, writePin } from "./fetch.js";
import type { TransformedEdition, UpstreamReporters } from "./transform.js";
import { transform } from "./transform.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const GENERATED = join(
  ROOT,
  "packages",
  "core",
  "src",
  "data",
  "upstream.generated.ts",
);

const REPORTERS_JSON = "reporters_db/data/reporters.json";

function render(pin: Pin, result: ReturnType<typeof transform>, today: string): string {
  const edition = (e: TransformedEdition) =>
    `  {a:${JSON.stringify(e.abbrev)},n:${JSON.stringify(e.name)},` +
    `s:${JSON.stringify(e.series)},b:${e.start},e:${e.end === null ? "null" : e.end},` +
    `j:${JSON.stringify(e.jurisdiction)}${e.ambiguous ? ",x:1" : ""}}`;

  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Reporter data vendored from Free Law Project's \`reporters-db\`.
 * Regenerate with \`pnpm reporters:sync\`; the pin lives in
 * \`tools/reporters-db/pin.json\` and the transform in
 * \`tools/reporters-db/transform.ts\`.
 *
 * Source:    ${pin.source}
 * Revision:  ${pin.ref}
 * Licence:   ${pin.license} — ${pin.copyright}
 * Synced:    ${today}
 *
 * ${result.stats.editions} editions across ${result.stats.families} reporter families,
 * and ${result.stats.variations} recognised misspellings. ${result.stats.ambiguous} abbreviations are claimed by
 * more than one reporter; those carry the union of the date spans and are
 * flagged, so a year check can never accuse a citation that any claimant would
 * make valid.
 *
 * Field names are single letters because this ships to a browser and the table
 * is the largest thing in the bundle:
 * \`a\`bbrev, \`n\`ame, \`s\`eries, \`b\`egins, \`e\`nds, \`j\`urisdiction,
 * and \`x\` — present only when the abbreviation is ambiguous.
 */

export interface UpstreamEdition {
  readonly a: string;
  readonly n: string;
  readonly s: string;
  readonly b: number;
  readonly e: number | null;
  readonly j: "federal" | "regional" | "state" | "specialty";
  /** Present when more than one reporter uses this abbreviation. */
  readonly x?: 1;
}

/** The upstream revision this file was generated from. */
export const UPSTREAM_REVISION = ${JSON.stringify(pin.ref)};
export const UPSTREAM_SOURCE = ${JSON.stringify(pin.source)};

export const UPSTREAM_EDITIONS: readonly UpstreamEdition[] = [
${result.editions.map(edition).join(",\n")},
];

export const UPSTREAM_VARIATIONS: Readonly<Record<string, string>> = ${JSON.stringify(
    result.variations,
    null,
    0,
  )};
`;
}

/** What changed between the table on disk and the one just built. */
function summarise(previous: string, next: ReturnType<typeof transform>): string[] {
  const lines: string[] = [];

  const before = new Map<string, { b: number; e: number | null }>();
  for (const match of previous.matchAll(
    /\{a:("(?:[^"\\]|\\.)*"),.*?b:(\d+),e:(null|\d+)/g,
  )) {
    before.set(JSON.parse(match[1]!) as string, {
      b: Number(match[2]),
      e: match[3] === "null" ? null : Number(match[3]),
    });
  }

  if (before.size === 0) {
    lines.push(`  first sync: ${next.editions.length} editions`);
    return lines;
  }

  const after = new Map(next.editions.map((e) => [e.abbrev, { b: e.start, e: e.end }]));

  const added = [...after.keys()].filter((abbrev) => !before.has(abbrev));
  const removed = [...before.keys()].filter((abbrev) => !after.has(abbrev));
  const changed = [...after.entries()].filter(([abbrev, span]) => {
    const was = before.get(abbrev);
    return was && (was.b !== span.b || was.e !== span.e);
  });

  const show = (label: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`  ${label}: ${items.length}`);
    for (const item of items.slice(0, 12)) lines.push(`    ${item}`);
    if (items.length > 12) lines.push(`    … and ${items.length - 12} more`);
  };

  show("added", added);
  show("removed", removed);
  // Date changes are the ones that alter what the rules accuse people of, so
  // they are spelled out rather than counted.
  show(
    "date range changed",
    changed.map(([abbrev, span]) => {
      const was = before.get(abbrev)!;
      const span2 = (b: number, e: number | null) => `${b}–${e ?? "present"}`;
      return `${abbrev}: ${span2(was.b, was.e)} → ${span2(span.b, span.e)}`;
    }),
  );

  if (lines.length === 0) lines.push("  no changes");
  return lines;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const refIndex = args.indexOf("--ref");
  const ref = refIndex === -1 ? undefined : args[refIndex + 1];

  const pin = readPin();
  const movingPin = ref !== undefined && ref !== pin.ref;

  if (movingPin) {
    console.log(`Moving the pin: ${pin.ref} → ${ref}`);
    pin.ref = ref;
    // The digests describe the old revision; they cannot be checked against
    // a different one.
    for (const path of Object.keys(pin.files)) pin.files[path] = null;
  }

  console.log(`Fetching ${pin.source} at ${pin.ref}…`);
  const files = await fetchPinned(pin, { expectMatch: !movingPin });

  const reporters = files.find((file) => file.path === REPORTERS_JSON);
  if (!reporters) throw new Error(`${REPORTERS_JSON} is not in the pin.`);

  for (const file of files) {
    pin.files[file.path] = file.digest;
    console.log(`  ${file.path}  ${file.digest.slice(0, 16)}…`);
  }

  const result = transform(JSON.parse(reporters.contents) as UpstreamReporters);
  console.log(
    `\n${result.stats.editions} editions, ${result.stats.families} families, ` +
      `${result.stats.variations} variations, ${result.stats.ambiguous} ambiguous, ` +
      `${result.stats.undated} undated.`,
  );

  let previous = "";
  try {
    previous = readFileSync(GENERATED, "utf8");
  } catch {
    previous = "";
  }

  console.log("\nAgainst what is on disk:");
  for (const line of summarise(previous, result)) console.log(line);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  pin.syncedAt = today;

  writeFileSync(GENERATED, render(pin, result, today), "utf8");
  writePin(pin);

  console.log(`\nWrote ${GENERATED}`);
  console.log("Wrote tools/reporters-db/pin.json");
  console.log(
    "\nRead the diff before committing. A changed date range changes which " +
      "citations ReCite calls impossible.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
