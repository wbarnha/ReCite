/**
 * Copy the Tesseract worker and WebAssembly core into the built site.
 *
 * `tesseract.js` defaults to fetching three things from the jsDelivr CDN: its
 * worker script, its WebAssembly core, and the language model. That is three
 * separate ways to tell a third party that a request correlated with OCRing a
 * document came from someone's address, and none of them is compatible with
 * what `privacy.html` says. `scribe.js-ocr` had the same default and the same
 * treatment — see `tools/tessdata`, which handles the model both engines share.
 *
 * The core comes in several builds and `tesseract.js` picks one at runtime
 * according to what the browser supports, so the whole directory is copied
 * rather than a chosen file. The non-`lstm` builds are the larger ones and are
 * kept deliberately: they carry Tesseract's legacy engine as well as the LSTM
 * one, which is what makes a dual-engine run possible at all. That matters
 * here — `tools/tessdata` records shipping the 11 MB model precisely because
 * the legacy components improve accuracy on the kind of text a citation is
 * made of.
 *
 * These land in `dist/`, so the checksum pass covers them like every other
 * published file.
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "apps", "web", "dist");

/**
 * Served directory. Fixed rather than content-addressed, unlike the language
 * model: `corePath` is handed to `tesseract.js` as a directory it appends its
 * own chosen filename to, and the app has to be able to name it without
 * knowing which build the browser will pick.
 */
export const TESSERACT_DIR = "tesseract";

const require = createRequire(import.meta.url);

function workerSource(): string {
  return require.resolve("tesseract.js/dist/worker.min.js");
}

function coreDirectory(): string {
  return dirname(require.resolve("tesseract.js-core/package.json"));
}

/** The core build files, which is everything but the package's own metadata. */
function coreFiles(): string[] {
  return readdirSync(coreDirectory()).filter(
    (name) => name.endsWith(".js") || name.endsWith(".wasm"),
  );
}

export function copyTesseractRuntime(
  outDir: string = join(DIST, TESSERACT_DIR),
): string[] {
  const core = join(outDir, "core");
  mkdirSync(core, { recursive: true });

  const written: string[] = [];

  const worker = join(outDir, "worker.min.js");
  copyFileSync(workerSource(), worker);
  written.push(worker);

  for (const name of coreFiles()) {
    const target = join(core, name);
    copyFileSync(join(coreDirectory(), name), target);
    written.push(target);
  }

  return written;
}

/**
 * A digest over everything copied.
 *
 * Not used to name the directory — see {@link TESSERACT_DIR} — but printed at
 * build time so a change in the engine is visible in the log rather than only
 * in the checksum file.
 */
export function tesseractDigest(): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(workerSource()));
  for (const name of coreFiles().sort()) {
    hash.update(name);
    hash.update(readFileSync(join(coreDirectory(), name)));
  }
  return hash.digest("hex").slice(0, 12);
}

function main(): void {
  const written = copyTesseractRuntime();
  const bytes = written.reduce((total, path) => total + statSync(path).size, 0);
  console.log(
    `Copied the Tesseract runtime into ${TESSERACT_DIR}/ ` +
      `(${written.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, ` +
      `digest ${tesseractDigest()})`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
