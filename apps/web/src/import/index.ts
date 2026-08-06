/**
 * Turning a dropped file into text ReCite can check.
 *
 * Everything here runs in the page. A file read with `FileReader` never
 * touches a network — the browser's Content Security Policy forbids the app
 * opening a connection to anywhere but its own origin, and the only thing it
 * fetches from there is the OCR engine.
 *
 * Formats are decided by content first and extension second. A `.doc` that is
 * really a `.docx`, or a `.txt` that is really RTF, is common enough in a firm
 * that trusting the name would produce mangled text — and mangled text in a
 * citation checker means wrong offsets and wrong findings, not an obvious
 * failure.
 */

import type { ImportMetrics } from "./metrics.js";
import type { OcrSettings } from "./ocr-options.js";
import { DEFAULT_OCR_SETTINGS } from "./ocr-options.js";
import { readHtml, looksLikeHtml } from "./html.js";
import { readDocx, readOdt } from "./office.js";
import { looksLikeRtf, readRtf } from "./rtf.js";
import { looksLikeZip } from "./zip.js";

export interface ImportResult {
  readonly text: string;
  /** What the file turned out to be, for the status line. */
  readonly format: string;
  /** Set when some of the text came from OCR rather than from a text layer. */
  readonly ocr?: {
    /**
     * How many pages were recognised, when Scribe reports page numbers.
     * Zero means recognition ran but did not say over how many pages — the
     * fact that it ran is what matters, and a made-up count would be worse
     * than none.
     */
    readonly pages: number;
  };
  /** Anything the reader wants the user to know before trusting the text. */
  readonly warnings: readonly string[];
  /**
   * Where the time went, for the readers that measure themselves.
   *
   * Present on the PDF path, which is the only slow one. Held in the page and
   * discarded with it — see `metrics.ts` for why there is nowhere to send it.
   */
  readonly metrics?: ImportMetrics;
}

export class UnsupportedFormatError extends Error {
  override readonly name = "UnsupportedFormatError";
}

/** Progress during a slow import, so OCR does not look like a hang. */
export type ProgressHandler = (message: string) => void;

/**
 * Extensions offered in the file picker.
 *
 * Broader than the list actually parsed, because content sniffing means a
 * mislabelled file still works, and a picker that greys out the user's file is
 * worse than one that accepts it and explains.
 */
export const ACCEPTED_EXTENSIONS = [
  ".txt",
  ".text",
  ".md",
  ".markdown",
  ".rtf",
  ".doc",
  ".docx",
  ".odt",
  ".pdf",
  ".htm",
  ".html",
  ".xml",
  ".csv",
  ".log",
  ".json",
] as const;

const MAX_BYTES = 100 * 1024 * 1024;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Whether a buffer decodes as text with no control characters or NULs. */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    // Anything below space that is not tab, newline or carriage return.
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
  }
  return suspicious / Math.max(sample.length, 1) < 0.01;
}

const PDF_MAGIC = "%PDF-";

/**
 * Read a file into checkable text.
 *
 * `onProgress` is called for the slow paths only. OCR on a long scanned brief
 * takes minutes, and a progress line is the difference between waiting and
 * assuming it has crashed.
 */
export async function importDocument(
  file: File,
  onProgress: ProgressHandler = () => {},
  ocr: OcrSettings = DEFAULT_OCR_SETTINGS,
): Promise<ImportResult> {
  if (file.size === 0) {
    throw new UnsupportedFormatError(`${file.name} is empty.`);
  }
  if (file.size > MAX_BYTES) {
    throw new UnsupportedFormatError(
      `${file.name} is ${Math.round(file.size / 1024 / 1024)} MB, over the 100 MB limit.`,
    );
  }

  const extension = extensionOf(file.name);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));

  // --- PDF, by magic number -------------------------------------------
  if (head.startsWith(PDF_MAGIC)) {
    const { readPdf } = await import("./pdf.js");
    return readPdf(file, onProgress, ocr);
  }

  // --- ZIP-based office formats ---------------------------------------
  if (looksLikeZip(buffer)) {
    if (extension === ".odt") {
      return { text: await readOdt(buffer), format: "OpenDocument text", warnings: [] };
    }
    // `.docx` is the overwhelmingly common case, and an unlabelled ZIP of XML
    // is far more likely to be one than anything else a brief arrives as.
    try {
      return { text: await readDocx(buffer), format: "Word document", warnings: [] };
    } catch {
      return { text: await readOdt(buffer), format: "OpenDocument text", warnings: [] };
    }
  }

  // --- legacy binary .doc ---------------------------------------------
  // OLE compound file magic. Extracting text from these reliably needs a real
  // implementation of the format, and a half-working one would return
  // plausible-looking text with pieces missing — the worst outcome for a
  // citation checker, because the failure is invisible.
  if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    throw new UnsupportedFormatError(
      `${file.name} is a legacy Word 97–2003 document (.doc). ReCite cannot read ` +
        "that format reliably, and would rather refuse than return text with " +
        "pieces silently missing. Open it in Word and save as .docx, .rtf or .txt.",
    );
  }

  // --- text-based formats ---------------------------------------------
  if (!looksLikeText(bytes)) {
    throw new UnsupportedFormatError(
      `ReCite could not read ${file.name}. It is not text, a PDF, or an office ` +
        "document ReCite recognises.",
    );
  }

  const text = new TextDecoder("utf-8").decode(bytes);

  if (looksLikeRtf(text)) {
    return { text: readRtf(text), format: "Rich Text Format", warnings: [] };
  }
  if (looksLikeHtml(text) || extension === ".htm" || extension === ".html") {
    return { text: readHtml(text), format: "HTML", warnings: [] };
  }

  return {
    text: text.replace(/\r\n?/g, "\n"),
    format:
      extension === ".md" || extension === ".markdown" ? "Markdown" : "plain text",
    warnings: [],
  };
}
