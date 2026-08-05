/**
 * Remembering what a document said, for as long as the tab is open.
 *
 * OCR on a scanned brief is tens of seconds. Re-opening the same file — after
 * changing a Bluebook setting, after a reload of the editor, after saving and
 * opening the result — pays that again for an answer that cannot have changed.
 *
 * **The cache is in memory and nothing else, deliberately.** README and
 * `privacy.html` both say a document is read into memory in the page and is
 * gone when the tab closes. An IndexedDB or Cache Storage entry holding the
 * recognised text of a client's filing would make that false, and it would
 * make it false on a shared or firm-managed machine where the next user of
 * that browser profile could read it back. The performance win is not worth
 * rewriting the promise the tool is sold on, so this `Map` dies with the page
 * and there is a test that asserts nothing is persisted.
 *
 * The key is a hash of the file's bytes, not its name or its `lastModified`:
 * two different documents saved under one name must not collide, and the same
 * document arriving under two names should hit.
 */

import type { PdfEngine } from "./engine.js";
import type { ImportResult } from "./index.js";
import type { OcrSettings } from "./ocr-options.js";
import { ocrSettingsKey } from "./ocr-options.js";

/**
 * How many documents to remember.
 *
 * Small on purpose. Each entry holds the full text of a filing, and a user who
 * opens twenty documents in a session should not be carrying all twenty in
 * memory for the sake of the one they might reopen.
 */
const MAX_ENTRIES = 8;

/**
 * Above this, do not cache at all.
 *
 * A 100 MB PDF can yield megabytes of text, and holding several of those costs
 * more than the OCR it saves.
 */
const MAX_CACHED_CHARS = 2_000_000;

/** Insertion-ordered, so the oldest key is the first one `Map` yields. */
const entries = new Map<string, ImportResult>();

/**
 * SHA-256 of the file's contents, hex.
 *
 * `crypto.subtle` is available in every browser this app supports and in the
 * Word task pane, both of which are secure contexts. Hashing 100 MB is well
 * under a second and happens once per import.
 */
export async function fileKey(
  file: File,
  settings: OcrSettings,
  engine: PdfEngine,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  // The engine belongs in the key for the same reason the settings do: two
  // engines reading one file are two answers, and handing back the wrong one
  // would make the benchmark measure whichever ran first.
  return `${hex}:${ocrSettingsKey(settings)}:engine=${engine}`;
}

export function cached(key: string): ImportResult | undefined {
  const hit = entries.get(key);
  if (!hit) return undefined;

  // Re-insert so the most recently used entry is the last to be evicted.
  entries.delete(key);
  entries.set(key, hit);
  return hit;
}

export function remember(key: string, result: ImportResult): void {
  if (result.text.length > MAX_CACHED_CHARS) return;

  entries.delete(key);
  entries.set(key, result);

  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

/** Drop everything. Exposed for the UI's "forget opened documents" control. */
export function forgetAll(): void {
  entries.clear();
}

/** How many documents are being held, for the UI to be able to say so. */
export function cacheSize(): number {
  return entries.size;
}
