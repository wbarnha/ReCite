/**
 * Which stack reads a PDF.
 *
 * This seam exists for one reason: `scribe.js-ocr` is AGPL-3.0, and it is
 * compiled into the bundle this project publishes from GitHub Pages. That is
 * not compatible with the BSD-2-Clause the repository claims, and AGPL is on
 * enough corporate deny-lists to matter for a tool sold to law firms.
 *
 * The alternative is `pdfjs-dist` and `tesseract.js`, both Apache-2.0. The
 * question is not whether they exist — it is whether they read a scanned brief
 * as *accurately*. `tools/tessdata` documents shipping an eleven-megabyte
 * language model rather than a three-megabyte one because "a misread digit in
 * a volume number is a wrong citation that looks right", and Scribe earns part
 * of that accuracy by running Tesseract's legacy and LSTM engines and
 * reconciling them, which `tesseract.js` does not do.
 *
 * So both readers are kept, behind one interface, and `tools/bench/ocr.ts`
 * scores them against the same fixture. A licence argument settled by
 * measurement rather than by preference.
 *
 * Neither is loaded until a PDF is opened, and only the selected one is loaded
 * at all — they are separate dynamic imports, so a visitor downloads one
 * engine, never both.
 */

/** The two stacks, named for what distinguishes them. */
export type PdfEngine =
  /** `scribe.js-ocr`. AGPL-3.0. The incumbent, and the accuracy baseline. */
  | "scribe"
  /** `pdfjs-dist` + `tesseract.js`. Both Apache-2.0. The candidate. */
  | "permissive";

export const PDF_ENGINES: readonly PdfEngine[] = ["scribe", "permissive"];

/**
 * What ships today.
 *
 * Still Scribe: the licence is the reason to move, and accuracy is the reason
 * not to move blindly. This flips when the benchmark says it can.
 */
export const DEFAULT_PDF_ENGINE: PdfEngine = "scribe";

export const ENGINE_LICENCE: Record<PdfEngine, string> = {
  scribe: "AGPL-3.0",
  permissive: "Apache-2.0",
};

/**
 * An engine named in `?engine=`, if it is one we have.
 *
 * A query parameter rather than a control, for the same reason `?workers=` is:
 * this is a thing to measure, not a thing to ask a user to choose. An
 * unrecognised value falls back to the default rather than failing, because a
 * stale link should still open the app.
 */
export function engineFromQuery(search: string): PdfEngine {
  const raw = new URLSearchParams(search).get("engine");
  return PDF_ENGINES.find((engine) => engine === raw) ?? DEFAULT_PDF_ENGINE;
}
