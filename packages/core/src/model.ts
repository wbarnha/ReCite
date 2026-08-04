/**
 * The vocabulary every ReCite package shares.
 *
 * Nothing here knows how to find a citation or how to decide whether one is
 * wrong. These are the nouns: a span of text, a citation parsed out of it, a
 * complaint about it, and the edit that would resolve the complaint.
 */

/** How much a finding should worry the reader. */
export type Severity = "error" | "warning" | "info";

/** Whether a correction may be applied without a human looking at it. */
export type FixSafety =
  /** Purely presentational. The authority being pointed at does not change. */
  | "safe"
  /** Changes which authority is cited, or asserts something we inferred. */
  | "unsafe";

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

/** A half-open `[start, end)` character range in a document. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export function span(start: number, end: number): Span {
  if (start < 0 || end < start) {
    throw new RangeError(`invalid span: [${start}, ${end})`);
  }
  return { start, end };
}

export function spanLength(s: Span): number {
  return s.end - s.start;
}

/**
 * True when two ranges share at least one character.
 *
 * Zero-length spans never overlap anything, which keeps pure insertions from
 * blocking each other.
 */
export function spansOverlap(a: Span, b: Span): boolean {
  if (spanLength(a) === 0 || spanLength(b) === 0) return false;
  return a.start < b.end && b.start < a.end;
}

export function sliceSpan(text: string, s: Span): string {
  return text.slice(s.start, s.end);
}

/** What kind of authority a citation points at. */
export type CitationKind =
  /** `925 F.3d 1339` — volume, reporter, page. */
  | "case-reporter"
  /** `2019 WL 4639462` — a commercial database identifier. */
  | "database"
  /** `2013 IL App (1st) 111279-U` — a court-assigned neutral citation. */
  | "neutral"
  /** `11 U.S.C. § 362(a)` — a statute. */
  | "statute"
  /** `Id. at 166` */
  | "id"
  /** `Varghese, supra` */
  | "supra"
  /** `925 F.3d at 1341` — short form of an earlier full cite. */
  | "short-form";

export const SHORT_FORM_KINDS: ReadonlySet<CitationKind> = new Set([
  "id",
  "supra",
  "short-form",
]);

/** A citation the parser found, flattened into plain data. */
export interface ParsedCitation {
  /** Position in document order; the stable identifier rules refer to. */
  readonly index: number;
  readonly kind: CitationKind;
  /** Exactly the characters matched, as they appear in the source. */
  readonly text: string;
  readonly span: Span;
  /** Span including the case name and the trailing court/date parenthetical. */
  readonly fullSpan: Span;

  readonly volume?: string;
  /** The reporter abbreviation as written, e.g. `"S.Ct."`. */
  readonly reporter?: string;
  /** The canonical abbreviation it matched, e.g. `"S. Ct."`. */
  readonly reporterCanonical?: string;
  readonly page?: string;

  readonly year?: number;
  /** Court identifier resolved from the parenthetical, e.g. `"ca11"`. */
  readonly courtId?: string;
  /** The court as the author typed it, e.g. `"11th Cir."`. */
  readonly courtText?: string;
  /** Where {@link courtText} sits, so it can be rewritten in place. */
  readonly courtSpan?: Span;

  readonly caseName?: string;
  readonly pinCite?: string;
  /** Database identifier for `database` citations, e.g. `"WL"`. */
  readonly database?: string;
  /** Sequence number for database and neutral citations. */
  readonly databaseNumber?: string;
  /** Raw neutral-citation body, e.g. `"IL App (1st) 111279-U"`. */
  readonly neutralBody?: string;

  /**
   * Groups short forms with the full citation they refer to. `undefined`
   * means nothing earlier in the document matched, which is itself a finding.
   */
  readonly resourceKey?: string;

  /** Citations printed together for the same case, e.g. `88 S. Ct. 1753`. */
  readonly parallelOf?: number;
}

/** A replacement for one span of the source document. */
export interface Correction {
  readonly span: Span;
  readonly replacement: string;
  readonly safety: FixSafety;
  readonly description: string;
}

/** One complaint about one citation. */
export interface Diagnostic {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly message: string;
  readonly span: Span;
  readonly citationText: string;
  readonly correction?: Correction;
  readonly context?: Readonly<Record<string, unknown>>;
}

/** Everything ReCite knows about the citations in one document. */
export interface Extraction {
  readonly text: string;
  readonly citations: readonly ParsedCitation[];
  /** `resourceKey` -> citation indexes, in document order. */
  readonly resources: ReadonlyMap<string, readonly number[]>;
}

/** The canonical `"410 U.S. 113"` form, used as a lookup and grouping key. */
export function lookupKey(citation: ParsedCitation): string | undefined {
  if (citation.kind === "case-reporter") {
    const reporter = citation.reporterCanonical ?? citation.reporter;
    if (citation.volume && reporter && citation.page) {
      return `${citation.volume} ${reporter} ${citation.page}`;
    }
    return undefined;
  }
  if (citation.kind === "database" && citation.year && citation.databaseNumber) {
    return `${citation.year} ${citation.database} ${citation.databaseNumber}`;
  }
  if (citation.kind === "neutral" && citation.year && citation.neutralBody) {
    return `${citation.year} ${citation.neutralBody}`;
  }
  return undefined;
}

export function isShortForm(citation: ParsedCitation): boolean {
  return SHORT_FORM_KINDS.has(citation.kind);
}

export function isFullCitation(citation: ParsedCitation): boolean {
  return !isShortForm(citation);
}

/** 1-based `[line, column]` for a character offset. */
export function lineCol(text: string, offset: number): [number, number] {
  if (offset < 0) throw new RangeError("offset must be non-negative");
  const clamped = Math.min(offset, text.length);

  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return [line, clamped - lineStart + 1];
}
