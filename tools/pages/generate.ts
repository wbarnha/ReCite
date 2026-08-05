/**
 * Write the static privacy, terms and support pages into the built site.
 *
 * Generated into `dist/` alongside the manifest that points at them, for the
 * same reason the manifest is: AppSource requires these URLs to resolve, and
 * a page that lives anywhere other than next to the build it describes is a
 * page that can go stale without anyone noticing.
 *
 * Because they land in `dist/`, the checksum pass covers them automatically —
 * the privacy policy is hashed and published like every other file.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderPage } from "./chrome.js";
import { PAGES } from "./content.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "..", "apps", "web", "dist");

export function generatePages(outDir: string = DIST): string[] {
  mkdirSync(outDir, { recursive: true });

  return PAGES.map((page) => {
    const path = join(outDir, page.file);
    writeFileSync(path, renderPage(page), "utf8");
    return path;
  });
}

function main(): void {
  const written = generatePages();
  console.log(`Wrote ${written.length} static pages:`);
  for (const path of written) console.log(`  ${path}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
