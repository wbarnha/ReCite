/** Queries over the court table. */

import type { Court } from "./data/courts.js";
import { COURTS, NON_COURT_PARENTHETICALS } from "./data/courts.js";

export type { Court, CourtLevel } from "./data/courts.js";
export { COURTS, NON_COURT_PARENTHETICALS } from "./data/courts.js";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const BY_ID = new Map<string, Court>();

/**
 * Abbreviation -> every court that uses it. Aliases are indexed separately so
 * an alias can never shadow a real abbreviation belonging to another court.
 *
 * These are multimaps on purpose. `App. Div.` names both New York's and New
 * Jersey's intermediate appellate court, and answering with whichever was
 * loaded first would let ReCite relabel a New Jersey case as a New York one.
 */
const BY_ABBREV = new Map<string, Court[]>();
const BY_ALIAS = new Map<string, Court[]>();

function push(index: Map<string, Court[]>, key: string, court: Court): void {
  const bucket = index.get(key);
  if (bucket) bucket.push(court);
  else index.set(key, [court]);
}

for (const court of COURTS) {
  BY_ID.set(court.id, court);
  push(BY_ABBREV, normalize(court.abbrev), court);
  for (const alias of court.aliases ?? []) {
    push(BY_ALIAS, normalize(alias), court);
  }
}

export function courtById(id: string): Court | undefined {
  return BY_ID.get(id);
}

/** The abbreviation a citation should use for a court id. */
export function courtAbbrev(id: string): string | undefined {
  return BY_ID.get(id)?.abbrev;
}

export function courtExistedIn(court: Court, year: number): boolean {
  if (year < court.start) return false;
  return court.end === null || year <= court.end;
}

export function courtLifespan(court: Court): string {
  return `${court.start}–${court.end ?? "present"}`;
}

/**
 * Resolve the text of a citation parenthetical to a court.
 *
 * Returns `undefined` for anything that is not a court — `(en banc)`,
 * `(per curiam)`, a bare year — rather than guessing at the nearest match.
 * Refusing to answer is the safe outcome: a wrong court is a much worse
 * error than an un-normalised one.
 */
export function resolveCourt(text: string): Court | undefined {
  const key = normalize(text);
  if (!key) return undefined;
  if (NON_COURT_PARENTHETICALS.has(key)) return undefined;

  const matches = candidateCourts(text);
  // An abbreviation shared by two courts identifies neither. Refusing to
  // answer is the safe outcome; a wrong court is worse than an unknown one.
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Every court an abbreviation could name — empty, one, or several.
 *
 * Abbreviations and aliases are pooled rather than ranked. `App. Div.` is New
 * York's canonical abbreviation and New Jersey's alias; preferring the
 * canonical one would silently relabel every New Jersey appellate cite.
 */
export function candidateCourts(text: string): readonly Court[] {
  const key = normalize(text);
  if (!key || NON_COURT_PARENTHETICALS.has(key)) return [];

  const pooled = [...(BY_ABBREV.get(key) ?? []), ...(BY_ALIAS.get(key) ?? [])];
  const seen = new Set<string>();
  return pooled.filter((court) => {
    if (seen.has(court.id)) return false;
    seen.add(court.id);
    return true;
  });
}

/**
 * Split a citation parenthetical into its court and date parts.
 *
 * Handles the shapes that actually occur: `(1968)`, `(11th Cir. 2019)`,
 * `(Tex. App. Sept. 25, 2019)`, `(S.D.N.Y. Mar. 1, 2023)`.
 */
export function splitParenthetical(body: string): {
  courtText?: string;
  /** Offset of `courtText` within `body`. */
  courtOffset?: number;
  year?: number;
} {
  const yearMatch = /\b((?:1[5-9]|20)\d{2})\b/.exec(body);
  const year = yearMatch?.[1] ? Number(yearMatch[1]) : undefined;

  // Everything before the year is the court and, optionally, a month and day.
  const head = yearMatch ? body.slice(0, yearMatch.index) : body;

  // Drop a trailing month/day so `(Tex. App. Sept. 25, 2019)` yields
  // `Tex. App.` rather than `Tex. App. Sept. 25`.
  const withoutDate = head.replace(
    /\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{0,2}\s*,?\s*$/,
    "",
  );

  const trimmed = withoutDate.replace(/^[\s,;]+|[\s,;]+$/g, "");
  if (!trimmed) return { year };

  const courtOffset = withoutDate.indexOf(trimmed);
  return { courtText: trimmed, courtOffset, year };
}
