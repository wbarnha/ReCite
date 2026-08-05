/**
 * What the user gets to decide about optical character recognition.
 *
 * OCR is the one part of ReCite that guesses. Everything else either reads a
 * character or does not; recognition produces a character that was *probably*
 * there, and the ones it confuses — 1 for l, 0 for O, 5 for S — are what
 * citations are made of. So the choice of when to run it belongs to the person
 * who knows what the document is, not to a heuristic.
 *
 * These settings are also part of the cache key. Two runs over the same file
 * under different modes are different answers, and returning one for the other
 * would be a silent wrong result.
 */

/** When to recognise text from page images. */
export type OcrMode =
  /**
   * Read text layers where they exist, recognise only the pages without one.
   * The default, and right for nearly every document: OCRing a page that
   * already has perfect text can only make it worse.
   */
  | "auto"
  /**
   * Recognise every page, ignoring text layers.
   *
   * For a PDF whose text layer is present but wrong — a bad encoding, or an
   * earlier OCR pass baked in by a scanner. `auto` trusts such a layer; this
   * does not.
   */
  | "always"
  /**
   * Never recognise. Read text layers and nothing else.
   *
   * Fast and exact, and it returns nothing at all for a scan. Worth choosing
   * when you know the document is text-native and want no guessed characters
   * anywhere in the result.
   */
  | "never";

export const OCR_MODES: readonly OcrMode[] = ["auto", "always", "never"];

export const OCR_MODE_LABEL: Record<OcrMode, string> = {
  auto: "Scanned pages only",
  always: "Every page",
  never: "Never — text layers only",
};

export const OCR_MODE_HELP: Record<OcrMode, string> = {
  auto: "Reads text layers directly and recognises only pages that have none.",
  always:
    "Ignores text layers and recognises every page. Slower, and useful when a scanner has baked in a bad text layer.",
  never: "Reads text layers only. A scanned page returns nothing rather than a guess.",
};

/**
 * How many recognition workers to run.
 *
 * `null` leaves it to Scribe, which takes up to six in a browser. A number
 * caps it. The reason to cap it is not speed — it is that OCR saturating every
 * core makes the rest of the browser stutter, and a task pane that freezes
 * Word looks like a crash.
 */
export type WorkerCount = number | null;

export interface OcrSettings {
  readonly mode: OcrMode;
  readonly workers: WorkerCount;
}

export const DEFAULT_OCR_SETTINGS: OcrSettings = {
  mode: "auto",
  workers: null,
};

/**
 * A worker count from `?workers=N`, if there is a sane one.
 *
 * Deliberately a URL parameter rather than a control. It changes speed and not
 * results, so it is a support question rather than a feature — but it has to
 * be reachable from outside the page for `tools/bench` to sweep it, and
 * "tune this by rebuilding" is not a knob anyone will turn.
 *
 * Bounded at 16: `workerN` is passed to Scribe before initialisation, and a
 * number from a query string is a number a stranger can put in a link.
 */
export function workersFromQuery(search: string): WorkerCount {
  const raw = new URLSearchParams(search).get("workers");
  if (raw === null) return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) return null;
  return parsed;
}

/** Scribe's name for each mode. See its `extractText` docs for the full set. */
export function scribeOcrPages(mode: OcrMode): "autoShallow" | "all" | "none" {
  switch (mode) {
    case "auto":
      return "autoShallow";
    case "always":
      return "all";
    case "never":
      return "none";
  }
}

/**
 * A stable string identifying these settings, for the result cache.
 *
 * Any setting that can change the extracted text has to appear here. Adding
 * one and forgetting to include it means the cache hands back an answer
 * produced under the old setting, which is worse than not caching at all.
 */
export function ocrSettingsKey(settings: OcrSettings): string {
  return `mode=${settings.mode};workers=${settings.workers ?? "auto"}`;
}
