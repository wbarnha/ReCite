/**
 * Types for `scribe.js-ocr`, which ships none.
 *
 * Deliberately narrow: only the surface `pdf.ts` uses. The alternative — a
 * bare `declare module 'scribe.js-ocr'` — makes the whole library `any`, and
 * `any` on the code path that reads a client's document is exactly where a
 * typo becomes a silent wrong answer. Writing out the four things we call
 * meant discovering that `scribe.data` does not exist, which the `any` version
 * would have accepted and returned `undefined` from for ever.
 *
 * Checked against scribe.js-ocr 0.14.3.
 */

declare module "scribe.js-ocr" {
  /** Which pages to run OCR on. */
  type OcrPages =
    /** Leave text-native pages alone; OCR scanned and broken-encoding pages. */
    "autoShallow" | "auto" | "autoDeep" | "all" | "none";

  interface ExtractTextOptions {
    readonly ocrPages?: OcrPages;
  }

  interface ScribeOptions {
    /**
     * Directory holding `<lang>.traineddata.gz`. `null` means the jsDelivr
     * CDN, which this project never uses — see `tools/tessdata`.
     */
    langPath: string | null;
    workerN: number | null;
    progressHandler: (message: unknown) => void;
    warningHandler: (message: unknown) => void;
    errorHandler: (message: unknown) => void;
  }

  interface Scribe {
    readonly opt: ScribeOptions;
    /**
     * Read text from images and PDFs. `outputFormat` is `'txt'` here; the
     * others produce layout-preserving formats this project has no use for.
     */
    extractText(
      files: ReadonlyArray<File | string>,
      langs?: readonly string[],
      outputFormat?: "txt",
      options?: ExtractTextOptions,
    ): Promise<string>;
    /** Release the OCR workers. */
    terminate(): Promise<void>;
  }

  const scribe: Scribe;
  export default scribe;
}
