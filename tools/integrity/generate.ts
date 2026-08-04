/**
 * Make a build verifiable.
 *
 * Two things happen here, in this order and for a reason:
 *
 * 1. **Subresource Integrity is injected into the HTML.** Every local
 *    `<script>`, `<link rel=stylesheet>` and `<link rel=modulepreload>` gets an
 *    `integrity` attribute holding the SHA-384 of the file it loads. The
 *    browser then refuses to execute a script whose bytes have changed —
 *    protection that works at load time, without anyone having to run a check.
 *
 * 2. **Every file in `dist/` is hashed.** The digests go to
 *    `checksums.sha256`, in the format `sha256sum -c` understands, and to
 *    `integrity.json` alongside the version and commit. This is what lets
 *    someone confirm the deployed page is the one built from a given commit.
 *
 * The order matters: injecting SRI rewrites the HTML, so hashing has to come
 * afterwards or the published digest would not match the served file.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { IntegrityManifest } from "./shared.js";
import {
  CHECKSUM_FILE,
  DIST,
  hashTree,
  INTEGRITY_FILE,
  listFiles,
  readVersion,
  renderChecksumFile,
  sriHash,
} from "./shared.js";

function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Add `integrity` to every local script, stylesheet and preloaded module.
 *
 * `modulepreload` matters as much as `script` here. Vite emits the entry point
 * as a `<script>` and the shared chunk — which is most of the application — as
 * a `<link rel="modulepreload">`. An ES module import does *not* inherit the
 * importing script's integrity, so covering only `<script>` would leave the
 * bulk of the code unprotected.
 *
 * Only same-origin assets emitted by this build are covered. Office.js is
 * loaded from Microsoft's CDN and is deliberately left alone: Microsoft ships
 * updates to that URL, and pinning a hash would break the add-in the moment
 * they did.
 */
export function injectSri(
  html: string,
  resolve: (src: string) => Buffer | undefined,
): {
  html: string;
  covered: string[];
} {
  const covered: string[] = [];

  const patch = (tag: string, urlAttr: "src" | "href"): string => {
    if (/\sintegrity=/.test(tag)) return tag;

    const url = new RegExp(`${urlAttr}="([^"]+)"`).exec(tag)?.[1];
    if (!url || /^https?:|^\/\//.test(url)) return tag;

    const data = resolve(url);
    if (!data) return tag;

    covered.push(url);
    const withIntegrity = tag.replace(/\s*\/?>$/, ` integrity="${sriHash(data)}">`);
    return /\scrossorigin\b/.test(withIntegrity)
      ? withIntegrity
      : withIntegrity.replace(/\s*>$/, ` crossorigin="anonymous">`);
  };

  const patched = html
    .replace(/<script\b[^>]*\ssrc="[^"]+"[^>]*>/g, (tag) => patch(tag, "src"))
    .replace(/<link\b[^>]*\srel="(?:stylesheet|modulepreload)"[^>]*>/g, (tag) =>
      patch(tag, "href"),
    );

  return { html: patched, covered };
}

function main(): void {
  const version = readVersion();
  const builtAt = new Date().toISOString();

  // 1. Subresource Integrity.
  const htmlFiles = listFiles(DIST).filter((path) => path.endsWith(".html"));
  let coveredTotal = 0;

  for (const path of htmlFiles) {
    const full = join(DIST, path);
    const { html, covered } = injectSri(readFileSync(full, "utf8"), (url) => {
      // Vite emits absolute paths under the deployment base; both that and a
      // relative path resolve to the same file inside `dist/`.
      const candidate = url.replace(/^\/[^/]*\//, "").replace(/^\.?\//, "");
      try {
        return readFileSync(join(DIST, candidate));
      } catch {
        return undefined;
      }
    });

    writeFileSync(full, html, "utf8");
    coveredTotal += covered.length;
    console.log(`  ${path}: ${covered.length} subresource(s) pinned`);
  }

  // 2. Checksums, computed after the HTML is final.
  const files = hashTree(DIST);
  writeFileSync(join(DIST, CHECKSUM_FILE), renderChecksumFile(files), "utf8");

  const manifest: IntegrityManifest = {
    version,
    commit: commit(),
    builtAt,
    algorithm: "sha256",
    files,
  };
  writeFileSync(
    join(DIST, INTEGRITY_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(`\nHashed ${Object.keys(files).length} files`);
  console.log(`  ${CHECKSUM_FILE}  (sha256sum -c compatible)`);
  console.log(
    `  ${INTEGRITY_FILE} (version ${version}, commit ${manifest.commit.slice(0, 12)})`,
  );
  console.log(`  ${coveredTotal} subresource integrity attributes injected`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
