/**
 * Reading a PDF with `scribe.js-ocr`.
 *
 * The incumbent, and the accuracy baseline the permissive stack is measured
 * against. Its `autoShallow` mode is what makes the text-layer/scan decision
 * automatic: pages with a usable text layer are read directly and only pages
 * without one are recognised, which matters for accuracy as much as for speed.
 *
 * **Licence.** AGPL-3.0, which is the reason `pdf-permissive.ts` exists. See
 * `engine.ts`.
 *
 * **Nothing is fetched from a CDN.** Scribe's default is to pull language
 * models from jsDelivr; `opt.langPath` overrides that to this origin, and the
 * models are published alongside the app by `tools/tessdata`.
 */

import type Scribe from "scribe.js-ocr";

import type { ProgressHandler } from "./index.js";
import type { OcrSettings } from "./ocr-options.js";
import { scribeOcrPages } from "./ocr-options.js";
import type { PageExtraction } from "./pdf-engine-result.js";
import { langPath } from "./warmup.js";

type ScribeModule = { default: typeof Scribe };

let engine: Promise<ScribeModule> | undefined;

/**
 * The worker count the engine was started with.
 *
 * Scribe's `workerN` must be set before initialisation and is ignored after,
 * so changing it means tearing the engine down. Remembering what it started
 * with is what tells us whether that is necessary.
 */
let startedWithWorkers: number | null = null;

async function load(
  settings: OcrSettings,
  onProgress: ProgressHandler,
): Promise<ScribeModule> {
  if (engine && startedWithWorkers !== settings.workers) {
    await releaseScribeEngine();
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

export async function extractScribe(
  file: File,
  onProgress: ProgressHandler,
  settings: OcrSettings,
): Promise<PageExtraction> {
  const module = await load(settings, onProgress);
  const scribe = module.default;

  /**
   * Whether recognition ran, and over how many pages if that is knowable.
   *
   * Both, because they are separate facts and only one is reliable. Scribe
   * emits `{ type: "recognize" }` as a bare tick with no page number for this
   * document — 20 of them for a ten-page filing — so counting them would
   * report "20 pages" for a ten-page file. Where a page number *is* supplied
   * it is collected, and the count is only used when there is one.
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
    const text = await scribe.extractText([file], ["eng"], "txt", {
      ocrPages: scribeOcrPages(settings.mode),
    });
    return { text, recognitionRan, recognisedPages: recognisedPages.size };
  } finally {
    scribe.opt.progressHandler = () => {};
  }
}

/** Release the OCR workers. */
export async function releaseScribeEngine(): Promise<void> {
  if (!engine) return;
  const module = await engine;
  engine = undefined;
  startedWithWorkers = null;
  await module.default.terminate();
}
