/**
 * Reading a PDF with `pdfjs-dist` and `tesseract.js` — both Apache-2.0.
 *
 * The candidate stack in the licence question described in `engine.ts`. It has
 * to do by hand the thing Scribe does in one call: decide, page by page,
 * whether a text layer can be trusted, and recognise only the pages where it
 * cannot. That decision is the whole feature — OCRing a page that already has
 * perfect text can only make it worse — so it is written out below rather than
 * inherited.
 *
 * **Nothing is fetched from a CDN.** `tesseract.js` defaults to jsDelivr for
 * its worker, its WebAssembly core *and* its language model, which is three
 * separate ways to tell a third party that someone is OCRing a document. All
 * three are overridden to this origin. `pdfjs-dist` needs the same treatment
 * for its worker, done through Vite's `?url` import so the file is emitted
 * into our own bundle and cannot point anywhere else.
 */

import type { PDFPageProxy } from "pdfjs-dist";
// The `legacy` build, not the default one. pdf.js 6's modern build uses
// `Map.prototype.getOrInsertComputed`, a 2025 addition that a browser only a
// version or two behind does not have — and it fails at the first PDF, with
// `getOrInsertComputed is not a function`, rather than at load. A managed
// firm browser is exactly the machine that lags, so the compatibility build
// is the right default here even though it is slightly larger.
import * as pdfjsLegacy from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";

import { TESSDATA_DIR } from "../build-info.js";
import type { ProgressHandler } from "./index.js";
import type { OcrSettings } from "./ocr-options.js";
import { installStreamAsyncIterator } from "./stream-async-iterator.js";
import { repairSectionSymbols } from "./ocr-repair.js";
import type { PageExtraction } from "./pdf-engine-result.js";

/**
 * How few characters a page's text layer may yield before it is treated as a
 * scan.
 *
 * Scribe decides this with its own page classifier; this is the hand-written
 * stand-in. A page of a brief carries well over a thousand characters, and a
 * genuinely scanned page yields none or a handful of stray glyphs. A hundred
 * sits far from both, so the threshold is not doing delicate work.
 *
 * Erring low would mean trusting a broken text layer, which is the failure
 * that produces a citation with the wrong digits in it and no warning.
 */
const MIN_TEXT_LAYER_CHARS = 100;

/**
 * Render resolution, in the same terms Scribe uses.
 *
 * Tesseract wants roughly 300 DPI; a PDF's own unit is 72 per inch, so the
 * scale is the ratio. Capped by width for the same reason Scribe caps it —
 * a large-format page at 300 DPI is an enormous canvas, and browsers refuse
 * to allocate past a limit that varies by platform.
 */
const TARGET_DPI = 300;
const MAX_RENDER_WIDTH = 3500;

/** Where the language model lives. Shared with the Scribe path. */
function langPath(): string {
  return new URL(TESSDATA_DIR, document.baseURI).toString();
}

/** Where the Tesseract worker and WebAssembly core live. */
function tesseractPath(file: string): string {
  return new URL(`tesseract/${file}`, document.baseURI).toString();
}

let worker: Promise<TesseractWorker> | undefined;

async function ocrWorker(): Promise<TesseractWorker> {
  // OEM 2 — legacy *and* LSTM — rather than the LSTM-only default, on the
  // theory that Scribe's accuracy edge comes from running both engines.
  //
  // Measured, and it does not: with OEM 1 and with OEM 2 alike, Tesseract
  // reads `§§ 1544` as `§8§ 1544`, inventing a digit between the two section
  // symbols and destroying the statute citation. Raising the render
  // resolution to 450 DPI made it worse rather than better — both symbols
  // became `88`, which reads as plausible text instead of obvious damage.
  //
  // The setting is kept because it costs nothing and the full model is
  // shipped anyway, but it is not a fix. See `docs/testing.md` for what this
  // means for the licence question.
  worker ??= createWorker("eng", 2, {
    // Every one of these defaults to a jsDelivr URL. See the header.
    workerPath: tesseractPath("worker.min.js"),
    corePath: tesseractPath("core"),
    langPath: langPath(),
    gzip: true,
    // Tesseract's own chatter, which is not the user's problem.
    logger: () => {},
    errorHandler: () => {},
  });
  return worker;
}

/** Release the recognition worker. */
export async function releasePermissiveEngine(): Promise<void> {
  if (!worker) return;
  const held = worker;
  worker = undefined;
  await (await held).terminate();
}

// Before pdf.js is asked for anything. `getTextContent` iterates a
// `ReadableStream` with `for await`, which Safari has not shipped — see
// `stream-async-iterator.ts` for the whole of that story. Installed at module
// evaluation so it is in place however this module comes to be used.
installStreamAsyncIterator();

export async function extractPermissive(
  file: File,
  onProgress: ProgressHandler,
  settings: OcrSettings,
): Promise<PageExtraction> {
  const pdfjs = pdfjsLegacy;
  // Emitted into our own bundle by Vite, so it is same-origin by construction
  // rather than by configuration.
  const workerUrl = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

  const loading = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const document_ = await loading.promise;

  const pages: string[] = [];
  const recognised = new Set<number>();

  try {
    for (let number = 1; number <= document_.numPages; number++) {
      const page = await document_.getPage(number);

      const layer = settings.mode === "always" ? "" : await textLayerOf(page);

      const usable =
        settings.mode !== "always" && layer.trim().length >= MIN_TEXT_LAYER_CHARS;

      if (usable || settings.mode === "never") {
        pages.push(layer);
        page.cleanup();
        continue;
      }

      onProgress(
        `Reading text from page images — page ${number} of ${document_.numPages}…`,
      );
      pages.push(await recognisePage(page));
      recognised.add(number);
      page.cleanup();
    }
  } finally {
    // The loading task owns the worker; cleaning up the proxy alone leaves it
    // running, and a long session would accumulate one per document opened.
    await loading.destroy();
  }

  return {
    text: pages.join("\n\n"),
    recognitionRan: recognised.size > 0,
    recognisedPages: recognised.size,
  };
}

/** The text a page already carries, if any. */
async function textLayerOf(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();

  let text = "";
  for (const item of content.items) {
    const entry = item as { str?: string; hasEOL?: boolean };
    if (typeof entry.str !== "string") continue;
    text += entry.str;
    if (entry.hasEOL) text += "\n";
    else text += " ";
  }
  return text;
}

/** Rasterise a page and recognise it. */
async function recognisePage(page: PDFPageProxy): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const wanted = TARGET_DPI / 72;
  const scale = Math.min(wanted, MAX_RENDER_WIDTH / base.width);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser refused a 2D canvas for OCR");
  // Tesseract does better on a white page than on transparency read as black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvas, canvasContext: context, viewport }).promise;

  const engine = await ocrWorker();
  const { data } = await engine.recognize(canvas);

  // Free it now rather than at the next collection: a 300 DPI page is tens of
  // megabytes, and a long filing would otherwise hold all of them at once.
  canvas.width = 0;
  canvas.height = 0;

  // Only recognised text is repaired. A text layer read straight out of the
  // PDF is exact, and running a character-rewriting pass over it could only
  // introduce an error that was not there.
  return repairSectionSymbols(data.text);
}
