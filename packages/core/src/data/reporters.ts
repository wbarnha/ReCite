/**
 * The reporter table ReCite checks against.
 *
 * Two sources, joined here:
 *
 * - **[`reporters-db`](https://github.com/freelawproject/reporters-db)**, from
 *   the Free Law Project, vendored into `upstream.generated.ts`. It supplies
 *   the names, abbreviations, date spans, and the misspellings people actually
 *   write — around 1,300 editions, against the fifty this project maintained
 *   by hand before.
 * - **`overlay.ts`**, which adds the things ReCite has rules about and a
 *   catalogue has no reason to record: which reporters publish only the
 *   Supreme Court, which carry non-precedential dispositions, and a short list
 *   of misspellings that turn up in drafting rather than in opinions.
 *
 * The join is a pure function of the two, computed once at module load. It
 * fetches nothing: the upstream data is committed, so a build produces the
 * same table whatever upstream is doing today. Reporter date ranges decide
 * which citations `DT001` calls impossible, and findings that change because
 * somebody else pushed a commit are not findings anyone should file a brief
 * from. Moving to a newer upstream revision is `pnpm reporters:sync`, and it
 * arrives as a reviewable diff.
 *
 * The exported shape is unchanged from when this file held the data by hand,
 * so nothing downstream had to move.
 */

import { ANNOTATIONS, LOCAL_VARIATIONS } from "./overlay.js";
import type { UpstreamEdition } from "./upstream.generated.js";
import {
  UPSTREAM_EDITIONS,
  UPSTREAM_REVISION,
  UPSTREAM_SOURCE,
  UPSTREAM_VARIATIONS,
} from "./upstream.generated.js";

export { UPSTREAM_REVISION, UPSTREAM_SOURCE };

export type ReporterJurisdiction = "federal" | "regional" | "state" | "specialty";

export interface ReporterEdition {
  /** Canonical Bluebook abbreviation, e.g. `"F. Supp. 2d"`. */
  readonly abbrev: string;
  readonly name: string;
  /** Family key shared by every edition of a series, e.g. `"F."`. */
  readonly series: string;
  readonly start: number;
  readonly end: number | null;
  readonly jurisdiction: ReporterJurisdiction;
  /**
   * More than one reporter uses this abbreviation.
   *
   * The date span is then the *union* of theirs, so a year check can only fire
   * when the year is impossible for every claimant. `Ark.` is two different
   * series, and there are twenty-odd more like it. Reporting a citation as
   * impossible because the wrong claimant happened to be picked is exactly the
   * confident false accusation this project is built to avoid.
   */
  readonly ambiguous?: true;
  /** Publishes only the Supreme Court of the United States. */
  readonly scotusOnly?: true;
  /** Carries dispositions that are not precedential. */
  readonly nonPrecedential?: true;
}

function expand(edition: UpstreamEdition): ReporterEdition {
  return {
    abbrev: edition.a,
    name: edition.n,
    series: edition.s,
    start: edition.b,
    end: edition.e,
    jurisdiction: edition.j,
    ...(edition.x ? { ambiguous: true as const } : {}),
    ...ANNOTATIONS.get(edition.a),
  };
}

export const REPORTERS: readonly ReporterEdition[] = UPSTREAM_EDITIONS.map(expand);

/**
 * Abbreviations that are recognisably wrong, mapped to what was meant.
 *
 * Purely typographic differences (`S.Ct.` for `S. Ct.`, `U. S.` for `U.S.`)
 * are not here — the parser matches those directly by treating internal
 * whitespace as optional, and reports them as a formatting note. This table is
 * for abbreviations that are substantively different, which deserve more than
 * a shrug.
 *
 * Local entries are applied last, so a deliberate local choice wins over an
 * upstream one for the same string.
 */
export const REPORTER_VARIATIONS: Readonly<Record<string, string>> = {
  ...UPSTREAM_VARIATIONS,
  ...LOCAL_VARIATIONS,
};
