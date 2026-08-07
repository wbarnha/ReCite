/**
 * Marking findings in the document without touching the document.
 *
 * The obvious way to underline a bad citation inside a `contenteditable` is to
 * wrap it in a `<span>`. That is also the wrong way: it puts ReCite's own
 * markup into the thing being edited, moves the caret every time the check
 * re-runs, and ends up in the saved file.
 *
 * The CSS Custom Highlight API exists for this. Ranges are registered with the
 * browser and painted through `::highlight(...)`, and the DOM is untouched —
 * so the text a user selects, copies and saves is exactly what they typed.
 *
 * Where the API is missing the highlights simply do not appear. That is a
 * deliberate choice about what degrades: the findings panel still lists
 * everything with a line and column, `Show` still selects the span, and the
 * check itself is unaffected. Nothing that decides whether a citation is wrong
 * depends on any of this.
 */

/** Painted layers, in the order they are declared in the stylesheet. */
export const HIGHLIGHT_NAMES = [
  "recite-error",
  "recite-warning",
  "recite-info",
  "recite-annotation",
] as const;

export type HighlightName = (typeof HIGHLIGHT_NAMES)[number];

/**
 * The layer that says "here, this one".
 *
 * Kept out of {@link HIGHLIGHT_NAMES} so a re-check does not wipe it: it is
 * set by a jump and cleared on a timer, and it belongs to a different clock
 * from the findings. Scrolling a citation into view is not enough on a page of
 * prose — the eye still has to find it, and a moment of colour is what does
 * that. It fades rather than staying, because a permanent mark on the last
 * thing you clicked becomes noise by the third click.
 */
export const TARGET_HIGHLIGHT = "recite-target";

/** How long the jump target stays lit. */
export const FLASH_MS = 1400;

/** Enough of the API to use it, so no lib update is needed to compile. */
interface HighlightRegistry {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

interface HighlightConstructor {
  new (...ranges: Range[]): object;
}

interface HighlightGlobals {
  Highlight?: HighlightConstructor;
  CSS?: { highlights?: HighlightRegistry };
}

function registry(): {
  Highlight: HighlightConstructor;
  highlights: HighlightRegistry;
} | null {
  const globals = globalThis as unknown as HighlightGlobals;
  const Highlight = globals.Highlight;
  const highlights = globals.CSS?.highlights;
  return Highlight && highlights ? { Highlight, highlights } : null;
}

export function highlightsSupported(): boolean {
  return registry() !== null;
}

/**
 * Replace every ReCite highlight with the ranges given.
 *
 * Replace rather than add: a re-check produces a new set of findings, and a
 * layer that accumulated would leave the previous run's marks on screen next
 * to the current one's.
 */
export function paint(layers: Partial<Record<HighlightName, readonly Range[]>>): void {
  const api = registry();
  if (!api) return;

  for (const name of HIGHLIGHT_NAMES) {
    const ranges = layers[name] ?? [];
    if (ranges.length === 0) {
      api.highlights.delete(name);
      continue;
    }
    api.highlights.set(name, new api.Highlight(...ranges));
  }
}

/**
 * Light a range up briefly, then let it go.
 *
 * Returns a cancel function so a second jump before the first has faded
 * replaces it rather than being cut short by the older timer.
 */
export function flash(range: Range, ms: number = FLASH_MS): () => void {
  const api = registry();
  if (!api) return () => undefined;

  api.highlights.set(TARGET_HIGHLIGHT, new api.Highlight(range));
  const timer = setTimeout(() => api.highlights.delete(TARGET_HIGHLIGHT), ms);

  return () => {
    clearTimeout(timer);
    api.highlights.delete(TARGET_HIGHLIGHT);
  };
}

/** Remove them all, for when the editor goes away. */
export function clear(): void {
  paint({});
  registry()?.highlights.delete(TARGET_HIGHLIGHT);
}
