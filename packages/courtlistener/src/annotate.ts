/**
 * Turning a verified citation and its pin cite into a note for the document.
 *
 * The output is an {@link Annotation}: plain data, with a span, a case name
 * and — where the page could actually be located — the passage that page
 * carries. What happens to it afterwards is somebody else's problem, which is
 * how a Word comment, an ODF annotation and a row in a JSON report can all be
 * the same feature.
 *
 * Short forms are annotated too, and that is most of the value. `Id. at 166`
 * and `925 F.3d at 1341` are where a brief actually makes its point; the full
 * citation three paragraphs earlier is just the introduction. The parser
 * already groups them by `resourceKey`, so the cluster looked up for the full
 * citation is reused rather than looked up again.
 */

import type { Extraction, ParsedCitation } from "@recite/core";
import { parsePinCite } from "@recite/core";

import type { CourtListenerClient } from "./http.js";
import type { Annotation, CourtListenerMatch, PinciteQuotation } from "./model.js";
import { quotePincite } from "./pincite.js";
import { RateLimiter } from "./throttle.js";
import { LOOKUPS_PER_MINUTE } from "./provider.js";

export interface AnnotateOptions {
  readonly client: CourtListenerClient;
  readonly limiter?: RateLimiter;
  readonly maxChars?: number;
  /** Ceiling on opinions fetched in one pass. Whatever is dropped is reported. */
  readonly maxAnnotations?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface AnnotateResult {
  readonly annotations: readonly Annotation[];
  /** Things the reader should know about the run, in plain words. */
  readonly notices: readonly string[];
}

export const DEFAULT_MAX_ANNOTATIONS = 60;

/** A citation worth annotating, paired with the cluster it resolved to. */
interface Candidate {
  readonly citation: ParsedCitation;
  readonly match: CourtListenerMatch;
  readonly page: string;
}

/**
 * Resolve the CourtListener match that governs a citation.
 *
 * A full citation has its own. A short form has none, because there was
 * nothing of its own to look up — so it inherits the match of the first full
 * citation sharing its `resourceKey`.
 */
export function matchForCitation(
  citation: ParsedCitation,
  extraction: Extraction,
  matches: ReadonlyMap<number, CourtListenerMatch>,
): CourtListenerMatch | undefined {
  const own = matches.get(citation.index);
  if (own) return own;
  if (!citation.resourceKey) return undefined;

  for (const index of extraction.resources.get(citation.resourceKey) ?? []) {
    const candidate = matches.get(index);
    if (candidate) return candidate;
  }
  return undefined;
}

/** The single page a pin cite points at, or `undefined` when it names none. */
export function pinPage(citation: ParsedCitation): string | undefined {
  const pin = parsePinCite(citation.pinCite);
  // `passim` names no page, and a pin cite with several is quoted at its
  // first: the alternative is several comments on one citation, which in a
  // margin is noise rather than help.
  if (!pin || pin.first === undefined) return undefined;
  return String(pin.first);
}

/**
 * The first page of the decision a citation points at.
 *
 * Needed so a pin cite to the opinion's own opening page is not reported as
 * missing — see `quotePincite`.
 */
function firstPageOf(
  citation: ParsedCitation,
  extraction: Extraction,
): string | undefined {
  if (citation.page) return citation.page;
  if (!citation.resourceKey) return undefined;
  for (const index of extraction.resources.get(citation.resourceKey) ?? []) {
    const page = extraction.citations[index]?.page;
    if (page) return page;
  }
  return undefined;
}

export async function annotateCitations(
  extraction: Extraction,
  matches: ReadonlyMap<number, CourtListenerMatch>,
  options: AnnotateOptions,
): Promise<AnnotateResult> {
  const limiter = options.limiter ?? new RateLimiter({ perWindow: LOOKUPS_PER_MINUTE });
  const notices: string[] = [];

  const candidates: Candidate[] = [];
  for (const citation of extraction.citations) {
    const page = pinPage(citation);
    if (!page) continue;

    const match = matchForCitation(citation, extraction, matches);
    // One cluster and one only. An ambiguous citation has not identified a
    // decision, so quoting "page 678" of whichever one came back first would
    // be attributing words to a case the author may not have cited.
    if (!match || match.status !== "found" || match.clusters.length !== 1) continue;

    candidates.push({ citation, match, page });
  }

  const cap = options.maxAnnotations ?? DEFAULT_MAX_ANNOTATIONS;
  const budget = candidates.slice(0, cap);
  if (candidates.length > budget.length) {
    notices.push(
      `Pulled quotations for the first ${budget.length} of ${candidates.length} ` +
        "pin cites. The rest were left alone rather than dropped silently.",
    );
  }

  /** One opinion, one fetch, however many pin cites land on the same page. */
  const quoted = new Map<string, PinciteQuotation>();
  const annotations: Annotation[] = [];
  let done = 0;

  for (const candidate of budget) {
    const cluster = candidate.match.clusters[0]!;
    const cacheKey = `${cluster.id}#${candidate.page}`;

    let quotation = quoted.get(cacheKey);
    if (!quotation) {
      const firstPage = firstPageOf(candidate.citation, extraction);
      quotation = await quotePincite(
        options.client,
        cluster.opinionUrls,
        candidate.page,
        cluster.url,
        {
          ...(options.maxChars === undefined ? {} : { maxChars: options.maxChars }),
          ...(firstPage === undefined ? {} : { firstPage }),
          beforeRequest: () => limiter.take(),
        },
      );
      quoted.set(cacheKey, quotation);
    }

    annotations.push(toAnnotation(candidate, quotation));
    done++;
    options.onProgress?.(done, budget.length);
  }

  const unquoted = annotations.filter((a) => !a.quotation).length;
  if (unquoted > 0) {
    notices.push(
      `${unquoted} pin cite${unquoted === 1 ? "" : "s"} could not be quoted — the ` +
        "note on each says why. ReCite does not guess at a passage.",
    );
  }

  return { annotations, notices };
}

function toAnnotation(candidate: Candidate, quotation: PinciteQuotation): Annotation {
  const cluster = candidate.match.clusters[0]!;
  return {
    citationIndex: candidate.citation.index,
    span: candidate.citation.span,
    anchorText: candidate.citation.text,
    caseName: cluster.caseName,
    citation: candidate.citation.text,
    pinCite: candidate.page,
    ...(quotation.text ? { quotation: quotation.text } : {}),
    ...(quotation.url
      ? { url: quotation.url }
      : cluster.url
        ? { url: cluster.url }
        : {}),
    source: "CourtListener",
    ...(quotation.note ? { note: quotation.note } : {}),
  };
}

/**
 * The text of the comment a document will carry.
 *
 * Written to be read inside a margin bubble in Word, by someone who has to
 * decide whether the sentence in front of them is supported. So: the case, the
 * page, the words, and where they came from — and a caveat rather than a
 * silence when there are no words.
 */
export function annotationComment(annotation: Annotation): string {
  const lines: string[] = [];
  const cite = annotation.pinCite
    ? `${annotation.caseName}, at ${annotation.pinCite}`
    : annotation.caseName;
  lines.push(cite);

  if (annotation.quotation) {
    lines.push(`“${annotation.quotation}”`);
  }
  if (annotation.note) {
    lines.push(annotation.note);
  }
  lines.push(
    annotation.url
      ? `${annotation.source}: ${annotation.url}`
      : `Source: ${annotation.source}`,
  );
  lines.push(
    "Retrieved by ReCite. A quotation is evidence to check, not a substitute " +
      "for reading the opinion.",
  );

  return lines.join("\n");
}
