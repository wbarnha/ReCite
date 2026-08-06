/**
 * Text out of a PDF, with OCR for the pages that have none.
 *
 * A PDF is two quite different things wearing one extension. A PDF produced by
 * Word carries a text layer, and reading it is exact. A PDF produced by a
 * scanner is a stack of photographs, and getting text out means optical
 * character recognition — which is a guess, and sometimes a wrong one.
 *
 * This module holds everything around the reading itself: the session cache,
 * the timings, and the accuracy warning. `pdf-permissive.ts` does the reading,
 * with `pdfjs-dist` and `tesseract.js`.
 *
 * There used to be a second reader here, on `scribe.js-ocr`. It was removed
 * when the permissive stack matched it — same 99.6% character similarity, same
 * 100% citation recall, and faster — because Scribe is AGPL-3.0 and this
 * project is BSD-2-Clause. See `docs/testing.md` for the measurement and
 * `ocr-repair.ts` for the one thing that had to be fixed to get there.
 *
 * **The engine is loaded lazily**, from this module, which nothing imports
 * statically. Someone who pastes text or opens a `.docx` never downloads it.
 * `warmup.ts` starts the download earlier when there is evidence a PDF is
 * coming, without breaking that.
 */

import { cached, fileKey, remember } from "./cache.js";
import type { ImportResult, ProgressHandler } from "./index.js";
import { ImportTimer } from "./metrics.js";
import type { OcrSettings } from "./ocr-options.js";
import { DEFAULT_OCR_SETTINGS } from "./ocr-options.js";
import { warmModel } from "./warmup.js";

/**
 * Read a PDF into text.
 *
 * Reports progress because this is the one slow path in the application: OCR
 * on a long scanned brief is minutes of work, and without a running commentary
 * it is indistinguishable from a hang.
 */
export async function readPdf(
  file: File,
  onProgress: ProgressHandler,
  settings: OcrSettings = DEFAULT_OCR_SETTINGS,
): Promise<ImportResult> {
  const timer = new ImportTimer();

  const key = await timer.measure("hash", () => fileKey(file, settings));
  const hit = cached(key);
  if (hit) {
    return {
      ...hit,
      metrics: timer.finish({
        bytes: file.size,
        chars: hit.text.length,
        ocrPages: hit.ocr?.pages ?? 0,
        recognised: hit.ocr !== undefined,
        engineColdStart: false,
        cacheHit: true,
      }),
    };
  }

  // Awaited rather than raced. A warm started at `dragover` has usually
  // finished by now; if it has not, awaiting it is still better than letting
  // the engine open a second request for the same eleven megabytes.
  if (settings.mode !== "never") {
    onProgress("Fetching the language model…");
    await timer.measure("model", () => warmModel());
  }

  onProgress("Reading the PDF…");

  const { extractPermissive } = await import("./pdf-permissive.js");
  const read = await timer.measure("read", () =>
    extractPermissive(file, onProgress, settings),
  );

  const warnings: string[] = [];
  if (read.recognitionRan) {
    const scope =
      read.recognisedPages > 0
        ? `${read.recognisedPages} page${read.recognisedPages === 1 ? "" : "s"} of this PDF had`
        : "Part of this PDF had";
    warnings.push(
      `${scope} no usable text layer and was read by optical character ` +
        "recognition. OCR misreads characters, and the ones it confuses — " +
        "1 for l, 0 for O, 5 for S — are what citations are made of. Check " +
        "anything reported here against the original before relying on it.",
    );
  }
  if (!read.text.trim()) {
    warnings.push(
      settings.mode === "never"
        ? "No text could be read from this PDF. Recognition is turned off, " +
            "so a scanned document returns nothing — set OCR to run on " +
            "scanned pages to read it."
        : "No text could be read from this PDF. If it is a scan, it may be " +
            "too faint or too low-resolution for OCR.",
    );
  }

  const result: ImportResult = {
    text: normalise(read.text),
    format: read.recognitionRan ? "PDF, partly read by OCR" : "PDF",
    warnings,
    ...(read.recognitionRan ? { ocr: { pages: read.recognisedPages } } : {}),
  };

  remember(key, result);

  return {
    ...result,
    metrics: timer.finish({
      bytes: file.size,
      chars: result.text.length,
      ocrPages: read.recognisedPages,
      recognised: read.recognitionRan,
      engineColdStart: true,
      cacheHit: false,
    }),
  };
}

/**
 * Tidy the text a PDF gives up.
 *
 * PDF extraction routinely breaks a word across lines with a hyphen, and a pin
 * cite split that way — `371-\n72` — is lost entirely unless it is rejoined.
 * The parser has its own tolerance for this, but repairing it here means the
 * offsets a fix is applied at match what the user is looking at.
 */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Release the recognition workers. */
export async function releasePdfEngine(): Promise<void> {
  const { releasePermissiveEngine } = await import("./pdf-permissive.js");
  await releasePermissiveEngine();
}
