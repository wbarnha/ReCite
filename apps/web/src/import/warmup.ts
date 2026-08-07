/**
 * Starting the slow parts before they are asked for.
 *
 * Opening a scanned PDF is four things in a row, and three of them are dead
 * time the user spends staring at a progress line: download the engine chunk,
 * download an eleven-megabyte language model, parse the PDF, recognise the
 * pages. Only the last is real work. This module moves the two downloads
 * earlier, so they overlap the seconds between "I am about to drop a file" and
 * "the file is open".
 *
 * ## What it must not do
 *
 * It must not fire on page load. `tools/test/browser.test.ts` asserts that
 * opening the site requests no `.wasm` and no `traineddata`, and
 * `docs/security.md` and the README both make that a stated property: the
 * engine is tens of megabytes and most visitors never open a PDF. Warming on
 * load would trade a documented promise for a couple of seconds.
 *
 * So warming is driven by *evidence of intent*, and the evidence has to be
 * specific enough to be worth acting on:
 *
 * - **Dragging a file over the drop zone.** `DataTransfer.items` exposes the
 *   MIME type during `dragover`, before the drop, so the engine is warmed only
 *   when the thing being dragged is actually a PDF. Someone dragging a `.docx`
 *   downloads nothing.
 * - **Opening the file picker.** No type is knowable there, so only the code
 *   chunk is fetched — a few hundred kilobytes — and the model waits until a
 *   PDF is in hand.
 *
 * ## Why a plain fetch, and not Cache Storage
 *
 * An earlier design precached the model into Cache Storage. That does nothing:
 * without a service worker the Cache Storage API is never consulted by an
 * ordinary `fetch`, so the engine's own request would have missed it entirely and
 * downloaded the model a second time. A service worker would fix that and is
 * the wrong trade here — this project's integrity story is checksums, SRI and
 * a footer naming the exact commit running, and a worker serving a stale
 * bundle undercuts all three.
 *
 * A plain `fetch` populates the browser's ordinary HTTP cache, which the
 * engine's later request *does* consult. That is the whole mechanism.
 */

import { TESSDATA_DIR } from "../build-info.js";

/**
 * Where the models are served from.
 *
 * Relative to the deployment base: the site lives at `/<repo>/` on GitHub
 * Pages and an absolute path would 404 there.
 */
export function langPath(): string {
  return new URL(TESSDATA_DIR, document.baseURI).toString();
}

function modelUrl(lang = "eng"): string {
  return `${langPath()}/${lang}.traineddata.gz`;
}

/** The engine chunk, imported once. */
let chunk: Promise<unknown> | undefined;

/** The model download, started once. */
let model: Promise<void> | undefined;

/**
 * Begin downloading the engine's code.
 *
 * Idempotent and safe to call on every pointer event. Returns immediately;
 * the caller is not meant to await it.
 */
export function warmEngine(): void {
  chunk ??= import("./pdf.js").catch(() => {
    // A failed warm is not an error the user should see — the real import
    // will try again and report properly if it fails then.
    chunk = undefined;
  });
}

/**
 * Begin downloading the language model.
 *
 * Returns the in-flight promise so the reader can await it rather than racing
 * it. That matters: two concurrent requests for the same URL are not reliably
 * coalesced, and a race would mean downloading eleven megabytes twice. The
 * reader awaits this before handing the file to the engine, by which point it
 * has usually already finished.
 */
export function warmModel(): Promise<void> {
  model ??= fetch(modelUrl(), { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`${response.status}`);
      // Drain it. A response left unread may never be written to the cache,
      // which would make the whole exercise pointless.
      await response.arrayBuffer();
    })
    .catch(() => {
      // Let the engine fetch it the ordinary way and report its own failure.
      model = undefined;
    });
  return model;
}

/**
 * Whether a drag carries a PDF, judged before the drop.
 *
 * `DataTransfer.items` is readable during `dragover` while `files` is not, but
 * only the *type* is exposed, never the name or the contents. A drag with no
 * usable type answers `false`: warming on a maybe would download the engine
 * for everyone dragging a Word document, which is the cost this check exists
 * to avoid.
 */
export function dragCarriesPdf(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;

  // Walked by index rather than spread or `for…of`.
  //
  // `DataTransferItemList` is an indexed collection, and the HTML standard does
  // not declare it iterable: there is no `Symbol.iterator` on it to find.
  // Engines that expose one do so of their own accord, so `[...transfer.items]`
  // is a coin toss that lands as `undefined is not a function` — thrown inside
  // a `dragover` handler, where the only visible symptom is that dropping a
  // file stops working. `length` and an index are all this needs, and they are
  // the two things the standard does guarantee.
  const items = transfer.items;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item?.kind === "file" && item.type === "application/pdf") return true;
  }
  return false;
}

/** Warm whatever the evidence justifies. Call from `dragover`. */
export function warmForDrag(transfer: DataTransfer | null): void {
  if (!dragCarriesPdf(transfer)) return;
  warmEngine();
  void warmModel();
}

/** Warm the code only. Call when the file picker opens. */
export function warmForPicker(): void {
  warmEngine();
}

/** Reset, so a test can assert warming happened rather than had already. */
export function resetWarmupForTests(): void {
  chunk = undefined;
  model = undefined;
}
