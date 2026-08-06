/**
 * What comes back from CourtListener, in ReCite's own vocabulary.
 *
 * The API's shapes are not re-exported. Everything crossing out of this
 * package is a type defined here, so a field CourtListener renames is a
 * compile error in one file rather than a silent `undefined` in the UI.
 */

import type { Span } from "@recite/core";

/** One decision CourtListener matched to a citation. */
export interface CourtListenerCluster {
  /** Opinion-cluster identifier, and what a pincite lookup is keyed on. */
  readonly id: number;
  readonly caseName: string;
  /** `YYYY-MM-DD`, as filed. */
  readonly dateFiled?: string;
  readonly year?: number;
  /** Absolute URL of the opinion on courtlistener.com. */
  readonly url?: string;
  readonly courtId?: string;
  /** How many later decisions cite it — a rough weight, shown for context. */
  readonly citationCount?: number;
  /** API URLs of the opinions in the cluster, in the order given. */
  readonly opinionUrls: readonly string[];
}

/** The outcome of looking one citation up. */
export interface CourtListenerMatch {
  /** {@link @recite/core!ParsedCitation.index} of the citation looked up. */
  readonly citationIndex: number;
  /** The `"410 U.S. 113"` key that was sent. */
  readonly key: string;
  readonly status: "found" | "not-found" | "ambiguous" | "invalid" | "unchecked";
  readonly clusters: readonly CourtListenerCluster[];
  /** Why, when the status is `invalid` or `unchecked`. */
  readonly note?: string;
}

/**
 * A quotation pulled from the page a pin cite points at.
 *
 * `text` is present only when the page was actually located in the opinion.
 * When it is absent, {@link note} says why — the honest answer is far more
 * useful here than a quotation from the wrong page, which would be a
 * misattribution printed into someone's brief.
 */
export interface PinciteQuotation {
  readonly page: string;
  readonly text?: string;
  readonly note?: string;
  /** Deep link to the opinion, with the page fragment when there is one. */
  readonly url?: string;
  /** True when the opinion was found but carries no star pagination. */
  readonly unpaginated?: boolean;
}

/**
 * A note ReCite can attach to a citation in the document.
 *
 * This is the unit that becomes a Word comment, an ODF annotation, or a row
 * in a findings report. It is plain data on purpose: the thing that writes a
 * `.docx` should not need to know that CourtListener exists.
 */
export interface Annotation {
  readonly citationIndex: number;
  /** Where in the document the comment is anchored. */
  readonly span: Span;
  /** Exactly the characters the anchor covers, for hosts with no offsets. */
  readonly anchorText: string;
  readonly caseName: string;
  readonly citation: string;
  readonly pinCite?: string;
  readonly quotation?: string;
  readonly url?: string;
  /** Where this came from, e.g. `"CourtListener"`. */
  readonly source: string;
  /** Present when there is a caveat rather than a quotation. */
  readonly note?: string;
}

export function clusterYear(cluster: CourtListenerCluster): number | undefined {
  if (cluster.year !== undefined) return cluster.year;
  const year = Number(cluster.dateFiled?.slice(0, 4));
  return Number.isInteger(year) ? year : undefined;
}
