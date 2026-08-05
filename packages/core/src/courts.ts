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

/**
 * A third index, keyed on the abbreviation with every space and trailing
 * period removed.
 *
 * `C.A.7` is already recorded as an alias of the Seventh Circuit, but Westlaw
 * prints it `C.A. 7.` — one space and one period away from a key we hold, and
 * therefore invisible to an exact lookup. Rather than write out every
 * punctuation variant by hand, this index answers the question "same letters
 * and digits, arranged the same way?"
 *
 * It is a fallback, consulted only when the exact indexes miss, and it feeds
 * the same multimap machinery: two courts under one squashed key means the
 * key identifies neither, and the caller refuses to answer. That is what
 * keeps this from turning punctuation-blindness into a wrong court.
 */
const BY_SQUASHED = new Map<string, Court[]>();

function push(index: Map<string, Court[]>, key: string, court: Court): void {
  const bucket = index.get(key);
  if (bucket) bucket.push(court);
  else index.set(key, [court]);
}

/** `"C.A. 7."` and `"C.A.7"` both become `"c.a.7"`. */
function squashPunctuation(text: string): string {
  return normalize(text).replace(/\s+/g, "").replace(/\.+$/, "");
}

for (const court of COURTS) {
  BY_ID.set(court.id, court);
  push(BY_ABBREV, normalize(court.abbrev), court);
  push(BY_SQUASHED, squashPunctuation(court.abbrev), court);
  for (const alias of court.aliases ?? []) {
    push(BY_ALIAS, normalize(alias), court);
    push(BY_SQUASHED, squashPunctuation(alias), court);
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
 *
 * Punctuation-insensitive matching is a fallback, not a peer: it runs only
 * when both exact indexes miss, so a spelling that is somebody's real
 * abbreviation can never be outvoted by another court's stray periods.
 */
export function candidateCourts(text: string): readonly Court[] {
  const key = normalize(text);
  if (!key || NON_COURT_PARENTHETICALS.has(key)) return [];

  const exact = [...(BY_ABBREV.get(key) ?? []), ...(BY_ALIAS.get(key) ?? [])];
  const pooled = exact.length
    ? exact
    : (BY_SQUASHED.get(squashPunctuation(text)) ?? []);

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
  const withoutDate = stripDateSuffix(head);

  const trimmed = trimSeparators(withoutDate);
  if (!trimmed) return { year };

  const courtOffset = withoutDate.indexOf(trimmed);
  return { courtText: trimmed, courtOffset, year };
}

/**
 * The month and day trailing a court name: ` Sept. 25, `, ` Mar. 1, `, ` Jan.`.
 *
 * Anchored at the end, and only ever applied to {@link DATE_SUFFIX_WINDOW}
 * characters. Both matter. The pattern is unanchored at the *start*, so a
 * regex engine retries it at every offset in the string it is given; on a
 * parenthetical padded with whitespace the leading `\s*` then walks the whole
 * remaining run before failing, once per offset. That is quadratic in the
 * length of the parenthetical — 8 KB took 56 ms and 50 KB took two seconds —
 * and a parenthetical is document text, so its length is chosen by whoever
 * wrote the document. Capping the search at a fixed window makes the work
 * constant regardless.
 */
const DATE_SUFFIX =
  /\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?(?:\s*\d{1,2})?[\s,]*$/;

/**
 * How far back to look for it. The longest real suffix is ` September 25, `
 * at fifteen characters, so this is roughly double what any date needs.
 */
const DATE_SUFFIX_WINDOW = 32;

/**
 * Strip whitespace, commas and semicolons from both ends.
 *
 * Written as a loop rather than as `replace(/^[\s,;]+|[\s,;]+$/g, "")`,
 * which is the obvious spelling and is quadratic. The `[\s,;]+$` branch is
 * anchored only at its end, so the engine retries it at every offset, and at
 * each one it consumes the whole remaining run of separators before the `$`
 * rejects it. On `"Jan" + 50,000 spaces + "!"` that one call took 2.2
 * seconds; this loop takes well under a millisecond. Parentheticals come
 * from the document being checked, so their length is not ours to assume.
 */
function trimSeparators(value: string): string {
  const isSeparator = (ch: string) => ch === "," || ch === ";" || /\s/.test(ch);

  let start = 0;
  let end = value.length;
  while (start < end && isSeparator(value[start]!)) start++;
  while (end > start && isSeparator(value[end - 1]!)) end--;
  return value.slice(start, end);
}

function stripDateSuffix(head: string): string {
  const cut = Math.max(0, head.length - DATE_SUFFIX_WINDOW);
  return head.slice(0, cut) + head.slice(cut).replace(DATE_SUFFIX, "");
}

/**
 * Courts whose standard abbreviation the written text is plainly a variant of.
 *
 * Matched by token expansion, not edit distance. Court abbreviations differ
 * from what people write by *spelling a token out* — `N. Dist. Ind.` for
 * `N.D. Ind.`, `S.D. New York` for `S.D.N.Y.`, `9 Cir.` for `9th Cir.` — and
 * an edit-distance match handles that badly in both directions. It scored
 * `N. Dist. Ind.` as no match at all, and confidently suggested `Cal.` for
 * `C.A. 7.`, which is a different court in a different state.
 *
 * So a candidate qualifies only when it has the same number of tokens and
 * every one of them is a prefix of its counterpart, in order. That is strict:
 * `C.A. 7.` gets no suggestion, because nothing here can tell that a Westlaw
 * convention means the Seventh Circuit. Missing it is the right failure. A
 * citation checker that renames a court is worse than one that says nothing.
 */
export function suggestCourts(written: string, limit = 3): string[] {
  const key = normalize(written);
  if (!key || NON_COURT_PARENTHETICALS.has(key)) return [];

  const target = tokenise(written);
  if (target.length === 0) return [];

  const matches: string[] = [];
  for (const court of COURTS) {
    if (matches.length >= limit) break;
    if (normalize(court.abbrev) === key) continue;
    if (isVariantOf(target, tokenise(court.abbrev))) matches.push(court.abbrev);
  }
  return matches;
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Whether `written` is the same abbreviation with tokens spelled out.
 *
 * Same count, and each pair share a prefix in whichever direction — `dist`
 * against `d`, `new` against `n`, `9` against `9th`.
 */
function isVariantOf(
  written: readonly string[],
  candidate: readonly string[],
): boolean {
  if (written.length !== candidate.length) return false;

  let differences = 0;
  for (const [index, token] of written.entries()) {
    const other = candidate[index]!;
    if (token === other) continue;
    if (!token.startsWith(other) && !other.startsWith(token)) return false;
    differences++;
  }

  // At least one token must actually differ, or this is the same string.
  return differences > 0;
}
