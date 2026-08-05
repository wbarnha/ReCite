/**
 * Bluebook conventions that differ between editions and between kinds of
 * writing, plus the pin cite arithmetic those conventions require.
 *
 * Two axes matter to a citation checker:
 *
 * **Edition.** The 21st edition (2020) added an allowance for court filings:
 * abbreviations in reporter names *may* be closed up to conserve space, so
 * `F.Supp.` and `S.Ct.` became acceptable alternatives to `F. Supp.` and
 * `S. Ct.` It is permission, not a requirement — which is why ReCite stops
 * complaining about the tightened form under that edition but still complains
 * when a document uses both.
 *
 * **Style.** The allowance is a Bluepages (court document) rule. Scholarly
 * writing keeps the spacing from rule 6.1(a): close up adjacent single
 * capitals, but keep a space between a single capital and a longer
 * abbreviation. So `U.S.` and `F.3d` close up in both styles, while `S. Ct.`
 * and `F. Supp.` keep their space in academic writing whatever the edition.
 *
 * Sources: Bluebook rules 6.1(a) and 3.2(a); the 21st edition's preface and
 * Bluepages. Where a rule is genuinely a matter of preference rather than
 * prescription, ReCite reports at `info` and offers no automatic fix.
 */

/** Editions ReCite knows how to check against. */
export type BluebookEdition = 20 | 21 | 22;

export const BLUEBOOK_EDITIONS: readonly BluebookEdition[] = [20, 21, 22];

/**
 * Which half of the book applies.
 *
 * The Bluebook is physically two rule sets printed on differently coloured
 * paper, and lawyers refer to them by that colour:
 *
 * - `practitioner` is the **Bluepages** — the blue-edged front section, whose
 *   `B` rules govern briefs, motions and memoranda filed with a court.
 * - `academic` is the **Whitepages** — the white main body, whose numbered
 *   rules govern law review footnotes and scholarly writing.
 *
 * The internal names stay `practitioner`/`academic` because they say what the
 * setting *does*; the Bluepages/Whitepages names are what the user sees, and
 * are what {@link styleName} and {@link describeProfile} produce.
 */
export type CitationStyle = "practitioner" | "academic";

export const CITATION_STYLES: readonly CitationStyle[] = ["practitioner", "academic"];

/** The Bluebook's own name for each half. */
export const STYLE_NAME: Record<CitationStyle, string> = {
  practitioner: "Bluepages",
  academic: "Whitepages",
};

/** What each half is for, in the words a user would use. */
export const STYLE_SCOPE: Record<CitationStyle, string> = {
  practitioner: "court documents",
  academic: "scholarly writing",
};

/** `"Bluepages"` or `"Whitepages"`. */
export function styleName(style: CitationStyle): string {
  return STYLE_NAME[style];
}

export interface BluebookProfile {
  readonly edition: BluebookEdition;
  readonly style: CitationStyle;
}

/** What most people checking a brief want. */
export const DEFAULT_PROFILE: BluebookProfile = {
  edition: 21,
  style: "practitioner",
};

/** How an edition is spoken: `21` -> `"21st"`. */
export function editionOrdinal(edition: BluebookEdition): string {
  return { 20: "20th", 21: "21st", 22: "22nd" }[edition];
}

export function describeProfile(profile: BluebookProfile): string {
  return `Bluebook ${editionOrdinal(profile.edition)} edition, ${styleName(profile.style)} (${STYLE_SCOPE[profile.style]})`;
}

/**
 * Whether the edition and style permit closing up a reporter abbreviation.
 *
 * The allowance arrived in the 21st edition and applies to court filings, so
 * `119 S.Ct. 662` is acceptable in a brief written to the 21st or 22nd and is
 * a spacing error under the 20th or in scholarly writing.
 */
export function allowsTightenedAbbreviations(profile: BluebookProfile): boolean {
  return profile.edition >= 21 && profile.style === "practitioner";
}

/** How a written abbreviation differs from the canonical one. */
export type SpacingVariant =
  /** Identical. */
  | "same"
  /** Canonical with spaces removed: `S.Ct.` for `S. Ct.` */
  | "tightened"
  /** Canonical with spaces added: `U. S.` for `U.S.` */
  | "loosened"
  /** Different characters, not merely different spacing. */
  | "different";

export function spacingVariant(written: string, canonical: string): SpacingVariant {
  if (written === canonical) return "same";

  const strip = (value: string) => value.replace(/\s+/g, "");
  if (strip(written) !== strip(canonical)) return "different";

  const spaces = (value: string) => value.length - strip(value).length;
  return spaces(written) < spaces(canonical) ? "tightened" : "loosened";
}

// ------------------------------------------------------------- pin cites ---

/**
 * Every dash a page range might be typed with.
 *
 * Bluebook rule 3.2(a) shows an en dash, but real documents arrive with a
 * plain hyphen from a keyboard, an em dash from an autocorrect, and — from
 * PDF extraction — figure dashes, non-breaking hyphens and even the Unicode
 * minus sign. A parser that accepts only one of them loses the pin cite, and
 * losing the pin cite means the page checks silently stop running.
 */
export const DASH_CHARACTERS = [
  "-", // hyphen-minus
  "‐", // hyphen
  "‑", // non-breaking hyphen
  "‒", // figure dash
  "–", // en dash
  "—", // em dash
  "―", // horizontal bar
  "−", // minus sign
] as const;

/** Character class fragment matching any of {@link DASH_CHARACTERS}. */
export const DASH_CLASS = `[${DASH_CHARACTERS.join("")}]`;

export interface PageRange {
  readonly from: number;
  /** The end page, expanded: 372 for both `371-72` and `371-372`. */
  readonly to: number;
  /**
   * The end page exactly as written — `"72"` or `"372"`.
   *
   * Kept because {@link to} cannot distinguish the two, and the rule 3.2(a)
   * check is entirely about which of them the author typed. Inferring it by
   * searching the raw text instead would misfire on a pin cite like
   * `372, 371-72`, where the standalone page happens to equal the range's end.
   */
  readonly writtenTo: string;
}

/** A pin cite, broken into the pages it points at. */
export interface PinCite {
  /** Exactly as written, including whatever dash was used. */
  readonly raw: string;
  /** Single pages, in the order given. */
  readonly pages: readonly number[];
  readonly ranges: readonly PageRange[];
  /** `passim` — the point appears throughout, so no page is given. */
  readonly passim: boolean;
  /** The lowest page mentioned, which is what the range checks compare. */
  readonly first?: number;
}

const PAGE_OR_RANGE = new RegExp(
  String.raw`(\d{1,6})(?:\s*${DASH_CLASS}\s*(\d{1,6}))?`,
  "g",
);

/**
 * Parse a pin cite into the pages it refers to.
 *
 * Handles `598`, `371-72`, `371–72`, `371—72`, `123, 125, 130`,
 * `371-72, 380` and `passim`. Returns `undefined` only when there is nothing
 * page-like in the input at all.
 */
export function parsePinCite(raw: string | undefined): PinCite | undefined {
  if (!raw) return undefined;

  const trimmed = raw.trim();
  const passim = /\bpassim\b/i.test(trimmed);

  const pages: number[] = [];
  const ranges: PageRange[] = [];

  PAGE_OR_RANGE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PAGE_OR_RANGE.exec(trimmed)) !== null) {
    const from = Number(match[1]);
    if (match[2] === undefined) {
      pages.push(from);
      continue;
    }
    // `371-72` means 371 to 372: the second number is an abbreviation of the
    // first with its leading digits dropped (rule 3.2(a)).
    ranges.push({ from, to: expandTo(from, match[2]), writtenTo: match[2] });
  }

  if (!passim && pages.length === 0 && ranges.length === 0) return undefined;

  const all = [...pages, ...ranges.map((r) => r.from)];
  return {
    raw: trimmed,
    pages,
    ranges,
    passim,
    first: all.length ? Math.min(...all) : undefined,
  };
}

/**
 * Expand the abbreviated end of a range.
 *
 * `371-72` is pages 371 to 372, not 371 to 72. When the second number has
 * fewer digits than the first, its digits replace the tail of the first.
 * A second number that is already longer, or that would go backwards, is
 * taken at face value so the reversed-range check can see it.
 */
export function expandTo(from: number, writtenTo: string): number {
  const fromText = String(from);
  if (writtenTo.length >= fromText.length) return Number(writtenTo);

  const expanded = Number(
    fromText.slice(0, fromText.length - writtenTo.length) + writtenTo,
  );
  return expanded >= from ? expanded : Number(writtenTo);
}

/**
 * The Bluebook rule 3.2(a) form of a page range.
 *
 * Repetitious leading digits are dropped from the second number, but the last
 * two digits are always kept: `371-372` becomes `371-72`, `1204-1208` becomes
 * `1204-08`, and `98-102` is left alone because the digits do not line up.
 */
export function abbreviateRange(from: number, to: number): string {
  const fromText = String(from);
  const toText = String(to);
  if (toText.length !== fromText.length || to <= from) return toText;

  // Keep at least the final two digits.
  let keep = 2;
  while (keep < toText.length) {
    const head = fromText.slice(0, toText.length - keep);
    if (head === toText.slice(0, toText.length - keep)) break;
    keep++;
  }

  return keep >= toText.length ? toText : toText.slice(toText.length - keep);
}
