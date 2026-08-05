/**
 * Text out of a PDF, with OCR for the pages that have none.
 *
 * A PDF is two quite different things wearing one extension. A PDF produced by
 * Word carries a text layer, and reading it is exact. A PDF produced by a
 * scanner is a stack of photographs, and getting text out means optical
 * character recognition — which is a guess, and sometimes a wrong one.
 *
 * Scribe.js handles both, and its `autoShallow` mode is what makes the
 * distinction automatic: pages with a usable text layer are read directly, and
 * only pages without one are OCRed. That matters for accuracy as much as for
 * speed, because OCRing a page that already has perfect text can only make it
 * worse. `ocr-options.ts` lets a user override that when they know better.
 *
 * **The whole engine is loaded lazily**, from this module, which nothing
 * imports statically. Someone who pastes text or opens a `.docx` never
 * downloads it. It is tens of megabytes and it would otherwise be the first
 * thing every visitor waited for. `warmup.ts` starts the download earlier when
 * there is evidence a PDF is coming, without breaking that.
 *
 * **Nothing is fetched from a CDN.** Scribe's default is to pull language
 * models from jsDelivr; `opt.langPath` overrides that to this origin, and the
 * models are published alongside the app by `tools/tessdata`. See
 * `docs/security.md`.
 */

import type Scribe from "scribe.js-ocr";

import { cached, fileKey, remember } from "./cache.js";
import type { ImportResult, ProgressHandler } from "./index.js";
import { ImportTimer } from "./metrics.js";
import type { OcrSettings } from "./ocr-options.js";
import { DEFAULT_OCR_SETTINGS, scribeOcrPages } from "./ocr-options.js";
import { langPath, warmModel } from "./warmup.js";

/** The module shape, so the lazy import stays typed. */
type ScribeModule = { default: typeof Scribe };

/** Loaded once and reused: initialising the workers is the expensive part. */
let engine: Promise<ScribeModule> | undefined;

/**
 * The worker count the engine was started with.
 *
 * Scribe's `workerN` must be set before initialisation and is ignored after,
 * so changing it means tearing the engine down. Remembering what it was
 * started with is what tells us whether that is necessary.
 */
let startedWithWorkers: number | null = null;

async function load(
  settings: OcrSettings,
  onProgress: ProgressHandler,
): Promise<ScribeModule> {
  // A different worker count cannot be applied to a running engine.
  if (engine && startedWithWorkers !== settings.workers) {
    await releasePdfEngine();
  }

  if (!engine) {
    onProgress("Loading the OCR engine (one-time download)…");
    startedWithWorkers = settings.workers;
    engine = import("scribe.js-ocr").then((module) => {
      const scribe = module.default;
      // Self-hosted models. Without this, opening a scanned PDF would tell a
      // CDN that someone is OCRing a document.
      scribe.opt.langPath = langPath();
      scribe.opt.warningHandler = () => {};
      scribe.opt.workerN = settings.workers;
      return module;
    });
  }
  return engine;
}

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

  const coldStart = engine === undefined;
  const module = await timer.measure("engine", () => load(settings, onProgress));
  const scribe = module.default;

  // Awaited rather than raced. A warm started at `dragover` has usually
  // finished by now; if it has not, awaiting it is still better than letting
  // Scribe open a second request for the same eleven megabytes.
  if (settings.mode !== "never") {
    onProgress("Fetching the language model…");
    await timer.measure("model", () => warmModel());
  }

  onProgress("Reading the PDF…");

  /**
   * Whether recognition ran, and over how many pages if that is knowable.
   *
   * Both, because they are separate facts and only one is reliable. Scribe
   * emits `{ type: "recognize" }` as a bare tick with no page number for this
   * document — 20 of them for a ten-page filing — so counting them would
   * report "20 pages" for a ten-page file. Where a page number *is* supplied
   * it is collected, and the count is only shown when there is one.
   *
   * An earlier version watched for `type: "pageOCR"`, which Scribe never
   * emits at all. The *Mata* filing came back labelled a plain PDF with no
   * accuracy warning, despite obvious OCR damage in the text (`Affirma tion`,
   * `Opposi T I on`). Dropping that warning silently is worse than showing no
   * progress: it is the caveat a reader most needs.
   */
  let recognitionRan = false;
  const recognisedPages = new Set<number>();

  scribe.opt.progressHandler = (message: unknown) => {
    const event = message as { type?: string; n?: number } | undefined;
    if (event?.type !== "recognize") return;

    recognitionRan = true;
    if (typeof event.n === "number") recognisedPages.add(event.n);

    const pages = recognisedPages.size;
    onProgress(
      pages > 0
        ? `Reading text from page images — ${pages} page${pages === 1 ? "" : "s"} so far…`
        : "Reading text from page images…",
    );
  };

  try {
    const text = await timer.measure("read", () =>
      scribe.extractText([file], ["eng"], "txt", {
        ocrPages: scribeOcrPages(settings.mode),
      }),
    );

    const ocrPages = recognisedPages.size;
    const warnings: string[] = [];
    if (recognitionRan) {
      const scope =
        ocrPages > 0
          ? `${ocrPages} page${ocrPages === 1 ? "" : "s"} of this PDF had`
          : "Part of this PDF had";
      warnings.push(
        `${scope} no usable text layer and was read by optical character ` +
          "recognition. OCR misreads characters, and the ones it confuses — " +
          "1 for l, 0 for O, 5 for S — are what citations are made of. Check " +
          "anything reported here against the original before relying on it.",
      );
    }
    if (!text.trim()) {
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
      text: normalise(text),
      format: recognitionRan ? "PDF, partly read by OCR" : "PDF",
      warnings,
      ...(recognitionRan ? { ocr: { pages: ocrPages } } : {}),
    };

    remember(key, result);

    return {
      ...result,
      metrics: timer.finish({
        bytes: file.size,
        chars: result.text.length,
        ocrPages,
        recognised: recognitionRan,
        engineColdStart: coldStart,
        cacheHit: false,
      }),
    };
  } finally {
    scribe.opt.progressHandler = () => {};
  }
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

/** Release the OCR workers. */
export async function releasePdfEngine(): Promise<void> {
  if (!engine) return;
  const module = await engine;
  engine = undefined;
  startedWithWorkers = null;
  await module.default.terminate();
}
