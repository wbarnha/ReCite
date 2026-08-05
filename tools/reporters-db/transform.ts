/**
 * Turning Free Law Project's `reporters-db` into ReCite's reporter table.
 *
 * Pure: JSON in, data out, no I/O. That is deliberate — this is the code that
 * decides what the date-range rules will accuse people of, so it is the part
 * that most needs to be testable without a network.
 *
 * Upstream is keyed by reporter *family* (`"F."`), each family holding one or
 * more entries, each entry holding several *editions* (`F.`, `F.2d`, `F.3d`,
 * `F.4th`) with their own date spans, plus a map of misspellings to canonical
 * abbreviations. ReCite's model is flat: one record per edition. This flattens
 * it and throws away everything ReCite has no use for — notably
 * `mlz_jurisdiction`, which is most of the file's bulk and describes courts in
 * a vocabulary this project does not speak.
 *
 * @see https://github.com/freelawproject/reporters-db — BSD-2-Clause,
 *      Copyright (c) 2014, Free Law Project.
 */

/** The shape of one entry in upstream `reporters.json`. */
export interface UpstreamEntry {
  readonly cite_type: string;
  readonly name: string;
  readonly editions: Record<string, { start: string | null; end: string | null }>;
  readonly variations?: Record<string, string | string[]>;
}

export type UpstreamReporters = Record<string, readonly UpstreamEntry[]>;

/**
 * How ReCite classifies a reporter.
 *
 * Upstream's `cite_type` has eight values; these are the four ReCite
 * distinguishes. Nothing in the rule set branches on this today — it is
 * shown to a reader deciding whether a finding is worth acting on — so the
 * mapping errs towards being informative rather than precise.
 */
export type ReporterJurisdiction = "federal" | "regional" | "state" | "specialty";

const JURISDICTION: Record<string, ReporterJurisdiction> = {
  federal: "federal",
  scotus_early: "federal",
  state: "state",
  state_regional: "regional",
  neutral: "state",
  specialty: "specialty",
  specialty_west: "specialty",
  specialty_lexis: "specialty",
};

export interface TransformedEdition {
  readonly abbrev: string;
  readonly name: string;
  readonly series: string;
  readonly start: number;
  readonly end: number | null;
  readonly jurisdiction: ReporterJurisdiction;
  /**
   * Set when more than one reporter publishes under this abbreviation.
   *
   * `Ark.` is two different series with different date spans, and there are
   * twenty-odd more like it. The record keeps the *union* of the spans — see
   * {@link merge} — and this flag says the span is a union rather than one
   * reporter's actual life. A rule that wants to be certain can check it.
   */
  readonly ambiguous?: true;
}

export interface TransformResult {
  readonly editions: readonly TransformedEdition[];
  /** Misspelling to canonical abbreviation. */
  readonly variations: Readonly<Record<string, string>>;
  readonly stats: {
    readonly families: number;
    readonly editions: number;
    readonly variations: number;
    readonly ambiguous: number;
    readonly undated: number;
  };
}

/**
 * Upstream dates are ISO timestamps; ReCite works in years.
 *
 * A reporter that started in March 1880 covers 1880, so truncating to the year
 * is the right rounding in both directions: it widens the range slightly and
 * the rules only ever accuse when a year falls *outside* it.
 */
function toYear(value: string | null | undefined): number | null {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/**
 * Combine two records for the same abbreviation.
 *
 * The union of the spans, always. Picking one — which is what a plain
 * `Map.set` does, and what ReCite did before this data arrived — means the
 * year check runs against a reporter the author may not have meant, and
 * reports a citation as impossible when it is fine. This project would rather
 * miss a real error than manufacture a false one, so an ambiguous abbreviation
 * gets the widest range any of its claimants supports.
 */
function merge(a: TransformedEdition, b: TransformedEdition): TransformedEdition {
  return {
    abbrev: a.abbrev,
    // The earlier-starting reporter's name is the more likely referent for a
    // bare abbreviation, and it keeps the choice deterministic.
    name: a.start <= b.start ? a.name : b.name,
    series: a.start <= b.start ? a.series : b.series,
    start: Math.min(a.start, b.start),
    end: a.end === null || b.end === null ? null : Math.max(a.end, b.end),
    jurisdiction: a.jurisdiction,
    ambiguous: true,
  };
}

/**
 * Reporters with no recorded start date.
 *
 * Four upstream entries have none. A record with no start cannot support a
 * year check at all, and inventing one would be inventing the finding, so they
 * are kept as recognisable reporters with a span wide enough to accuse nobody.
 */
const UNDATED_START = 1600;

export function transform(upstream: UpstreamReporters): TransformResult {
  const byAbbrev = new Map<string, TransformedEdition>();
  const variations: Record<string, string> = {};

  let families = 0;
  let undated = 0;

  for (const [series, entries] of Object.entries(upstream)) {
    families++;

    for (const entry of entries) {
      const jurisdiction = JURISDICTION[entry.cite_type] ?? "specialty";

      for (const [abbrev, span] of Object.entries(entry.editions)) {
        const start = toYear(span.start);
        if (start === null) undated++;

        const record: TransformedEdition = {
          abbrev,
          name: entry.name,
          series,
          start: start ?? UNDATED_START,
          // An undated start means an unbounded range, not a range ending now.
          end: start === null ? null : toYear(span.end),
          jurisdiction,
        };

        const existing = byAbbrev.get(abbrev);
        byAbbrev.set(abbrev, existing ? merge(existing, record) : record);
      }

      for (const [wrong, right] of Object.entries(entry.variations ?? {})) {
        // Upstream allows a variation to map to several canonical forms. Only
        // an unambiguous one is useful for "did you mean", so the rest are
        // dropped rather than guessed at.
        const target = Array.isArray(right)
          ? right.length === 1
            ? right[0]
            : undefined
          : right;
        if (target !== undefined && !(wrong in variations)) variations[wrong] = target;
      }
    }
  }

  // A variation that points at an abbreviation no longer in the table would
  // suggest a correction to something that does not exist.
  for (const [wrong, right] of Object.entries(variations)) {
    if (!byAbbrev.has(right)) delete variations[wrong];
  }

  // And a "variation" identical to a real abbreviation is not a misspelling.
  for (const wrong of Object.keys(variations)) {
    if (byAbbrev.has(wrong)) delete variations[wrong];
  }

  const editions = [...byAbbrev.values()].sort((a, b) =>
    a.abbrev.localeCompare(b.abbrev),
  );

  return {
    editions,
    variations,
    stats: {
      families,
      editions: editions.length,
      variations: Object.keys(variations).length,
      ambiguous: editions.filter((edition) => edition.ambiguous).length,
      undated,
    },
  };
}
