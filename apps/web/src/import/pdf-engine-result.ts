/**
 * What a PDF reader hands back, whichever engine it is.
 *
 * Kept in its own module so `pdf.ts` can dispatch to either engine without
 * importing both — the engines are separate lazy chunks, and a shared type
 * that lived in one of them would drag it into the bundle alongside the other.
 */

export interface PageExtraction {
  /** The document's text, pages joined. */
  readonly text: string;
  /** Whether recognition ran at all. */
  readonly recognitionRan: boolean;
  /**
   * Pages recognised, where the engine can say.
   *
   * Zero with `recognitionRan` true is a real state, not a contradiction:
   * Scribe reports recognition without always reporting which page, and a
   * made-up count would be worse than none.
   */
  readonly recognisedPages: number;
}
