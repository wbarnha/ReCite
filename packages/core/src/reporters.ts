/** Queries over the reporter table. */

import type { ReporterEdition } from "./data/reporters.js";
import { REPORTERS, REPORTER_VARIATIONS } from "./data/reporters.js";

export type { ReporterEdition } from "./data/reporters.js";
export { REPORTERS, REPORTER_VARIATIONS } from "./data/reporters.js";

/**
 * Reduce an abbreviation to its identifying characters.
 *
 * `"S. Ct."`, `"S.Ct."` and `"S.  Ct ."` all squash to `"sct"`, which is how
 * the parser recognises a reporter however the author spaced it, and how
 * {@link differsOnlyCosmetically} tells a typographic slip from a genuinely
 * different abbreviation.
 */
export function squash(abbrev: string): string {
  return abbrev.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_SQUASHED = new Map<string, ReporterEdition>();
const BY_ABBREV = new Map<string, ReporterEdition>();
for (const edition of REPORTERS) {
  BY_ABBREV.set(edition.abbrev, edition);
  BY_SQUASHED.set(squash(edition.abbrev), edition);
}

const VARIATION_BY_SQUASHED = new Map<string, string>();
for (const [wrong, right] of Object.entries(REPORTER_VARIATIONS)) {
  VARIATION_BY_SQUASHED.set(squash(wrong), right);
}

/** Look up an edition by any spacing of its abbreviation. */
export function findReporter(abbrev: string): ReporterEdition | undefined {
  return BY_SQUASHED.get(squash(abbrev));
}

export function isKnownReporter(abbrev: string): boolean {
  return BY_SQUASHED.has(squash(abbrev));
}

/** The canonical abbreviation a recognised mis-spelling stands for. */
export function canonicalForVariation(abbrev: string): string | undefined {
  return VARIATION_BY_SQUASHED.get(squash(abbrev));
}

/** Whether two abbreviations differ only in spacing and punctuation. */
export function differsOnlyCosmetically(written: string, canonical: string): boolean {
  return squash(written) === squash(canonical);
}

/** Every edition of the same series, oldest first. */
export function seriesEditions(abbrev: string): ReporterEdition[] {
  const edition = findReporter(abbrev);
  if (!edition) return [];
  return REPORTERS.filter((e) => e.series === edition.series).sort(
    (a, b) => a.start - b.start,
  );
}

export function reporterCovers(edition: ReporterEdition, year: number): boolean {
  if (year < edition.start) return false;
  return edition.end === null || year <= edition.end;
}

/** Editions of the same series whose date range includes `year`. */
export function editionsCoveringYear(abbrev: string, year: number): ReporterEdition[] {
  return seriesEditions(abbrev).filter((e) => reporterCovers(e, year));
}

export function coverageLabel(edition: ReporterEdition): string {
  return `${edition.start}–${edition.end ?? "present"}`;
}

/** Levenshtein distance, capped for speed on obviously distant strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 4) return 99;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 99;
}

/**
 * Canonical abbreviations closest to an unrecognised token.
 *
 * Compares squashed forms so that spacing never counts as a difference — a
 * suggestion should be about the letters that are wrong. The caller decides
 * whether a suggestion is strong enough to act on.
 */
export function suggestReporters(abbrev: string, limit = 3): string[] {
  const target = squash(abbrev);
  if (!target) return [];

  interface Candidate {
    abbrev: string;
    distance: number;
    /** How far the candidate is from the input in length. */
    lengthDelta: number;
  }

  const scored: Candidate[] = [];
  const consider = (abbrev: string, comparedTo: string): void => {
    scored.push({
      abbrev,
      distance: editDistance(target, comparedTo),
      lengthDelta: Math.abs(target.length - comparedTo.length),
    });
  };

  for (const edition of REPORTERS) consider(edition.abbrev, squash(edition.abbrev));
  for (const [wrongSquashed, right] of VARIATION_BY_SQUASHED) {
    consider(right, wrongSquashed);
  }

  // A tolerance proportional to length: short abbreviations must match almost
  // exactly, longer ones can absorb a typo or two without becoming noise.
  const tolerance = target.length <= 3 ? 1 : target.length <= 6 ? 2 : 3;

  const seen = new Set<string>();
  return scored
    .filter((s) => s.distance > 0 && s.distance <= tolerance)
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        // Two candidates an equal number of edits away are separated by which
        // is closer in length. Without this, `Cal. Rprt. 3d` prefers the
        // seriesless `Cal. Rptr.` and silently drops the series number.
        a.lengthDelta - b.lengthDelta ||
        a.abbrev.localeCompare(b.abbrev),
    )
    .filter((s) => (seen.has(s.abbrev) ? false : (seen.add(s.abbrev), true)))
    .slice(0, limit)
    .map((s) => s.abbrev);
}
