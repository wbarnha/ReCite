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

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "apps", "web", "dist");

/** Served path. Must match `opt.langPath` in `apps/web/src/import/pdf.ts`. */
export const TESSDATA_DIR = "tessdata";

const LANGUAGES = ["eng"] as const;

const require = createRequire(import.meta.url);

/** Where the model lives inside the installed package. */
function modelPath(lang: string): string {
  // Resolved rather than hardcoded so a version bump that moves the file
  // fails here, at build time, instead of at the first OCR attempt.
  return require.resolve(`@tesseract.js-data/${lang}/4.0.0/${lang}.traineddata.gz`);
}

export function copyTessdata(outDir: string = join(DIST, TESSDATA_DIR)): string[] {
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
  console.log(`Copied ${written.length} OCR language model(s):`);
  for (const path of written) {
    const size = (statSync(path).size / 1024 / 1024).toFixed(1);
    console.log(`  ${path}  (${size} MB)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
