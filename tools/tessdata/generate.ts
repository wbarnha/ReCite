/**
 * Copy the OCR language model into the built site.
 *
 * Scribe.js fetches `.traineddata` from the jsDelivr CDN unless told
 * otherwise. That default is the wrong shape for this project twice over: it
 * puts a third party in the path of a document check, and it means the moment
 * someone opens a scanned PDF, a CDN learns that a request correlated with
 * OCRing a document came from their address. Neither is compatible with what
 * `privacy.html` says.
 *
 * So the model is copied out of the npm package into `dist/tessdata/` at build
 * time and `opt.langPath` is pointed at it. It lands in `dist/`, so the
 * checksum pass covers it like every other published file.
 *
 * The full `4.0.0` model, not the smaller `4.0.0_best_int`. Scribe runs
 * Tesseract's legacy and LSTM engines and reconciles them, which is measurably
 * better on the kind of text a citation is made of — and the legacy engine's
 * components exist only in the full model. Shipping the 2.9MB LSTM-only file
 * instead produced "Tesseract (legacy) engine requested, but components are
 * not present", and OCR failed outright.
 *
 * It costs about 11MB, downloaded once and only when someone actually opens a
 * PDF. Accuracy is worth more than the download here: a misread digit in a
 * volume number is a wrong citation that looks right.
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "apps", "web", "dist");

const LANGUAGES = ["eng"] as const;

const require = createRequire(import.meta.url);

/** Where the model lives inside the installed package. */
function modelPath(lang: string): string {
  // Resolved rather than hardcoded so a version bump that moves the file
  // fails here, at build time, instead of at the first OCR attempt.
  return require.resolve(`@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`);
}

/**
 * The served directory name, with the models' content hash in it.
 *
 * The reason is caching, and the reason it has to be the *directory* rather
 * than the file is Scribe: `opt.langPath` is a directory and the library
 * appends `<lang>.traineddata.gz` itself, so the filename is not ours to
 * choose. Versioning the directory gets the same effect — the URL changes if
 * and only if the bytes change.
 *
 * What this buys is narrower than it looks, and worth stating plainly. GitHub
 * Pages does not let anyone set `Cache-Control`; there is no `_headers` file
 * and no configuration for it. So this cannot make the model cacheable
 * *longer*. What it does is make revalidation cheap and correct: once Pages'
 * short freshness window lapses the browser re-checks, the ETag still matches
 * because a content-addressed URL never changes contents, and the answer is a
 * 304 instead of eleven megabytes. It also means a model upgrade can never be
 * served from a stale cache under the old name.
 *
 * Computed from the source files in `node_modules`, so the app bundle and this
 * copier derive the name from one function and cannot disagree.
 */
export function tessdataDir(): string {
  const hash = createHash("sha256");
  // Sorted, so the name does not depend on array order if a language is added.
  for (const lang of [...LANGUAGES].sort()) {
    hash.update(lang);
    hash.update(readFileSync(modelPath(lang)));
  }
  return `tessdata-${hash.digest("hex").slice(0, 12)}`;
}

export function copyTessdata(outDir: string = join(DIST, tessdataDir())): string[] {
  mkdirSync(outDir, { recursive: true });

  return LANGUAGES.map((lang) => {
    const source = modelPath(lang);
    const target = join(outDir, `${lang}.traineddata.gz`);
    copyFileSync(source, target);
    return target;
  });
}

function main(): void {
  const written = copyTessdata();
  console.log(`Copied ${written.length} OCR language model(s) into ${tessdataDir()}/:`);
  for (const path of written) {
    const size = (statSync(path).size / 1024 / 1024).toFixed(1);
    console.log(`  ${path}  (${size} MB)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
