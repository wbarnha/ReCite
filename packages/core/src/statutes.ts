/**
 * Reading the section part of a statutory citation.
 *
 * Bluebook rule 3.3(b) asks two things of a citation that names more than one
 * section, and both are invisible from the first section alone:
 *
 * - more than one section takes `§§`, not `§`;
 * - a *span* of sections keeps every digit. This is the opposite of rule
 *   3.2(a) for pages, where repetitious digits are dropped. `17 U.S.C.
 *   §§ 103-107` is right and `§§ 103-07` is wrong, while for pages `371-72`
 *   is right and `371-372` is wrong. Getting the two rules the same way round
 *   is the single most common way this goes wrong, and it is why ReCite reads
 *   sections with their own parser rather than reusing the pin cite one.
 *
 * The interpretation lives here rather than in the pattern because one shape
 * is genuinely ambiguous: a hyphen inside a C.F.R. rule name (`240.10b-5`) is
 * part of the name, not a span. {@link parseSections} resolves that by
 * refusing to read a hyphen as a span unless both sides are bare digits.
 */

import { DASH_CHARACTERS } from "./bluebook.js";

const DASHES: ReadonlySet<string> = new Set(DASH_CHARACTERS);

/** How the sections in a citation relate to one another. */
export type SectionJoin =
  /** One section: `§ 501`. */
  | "single"
  /** Several, listed: `§§ 1544, 1546`. */
  | "list"
  /** A span: `§§ 103-107`. */
  | "span";

export interface Sections {
  /** Each section as written, in order. */
  readonly items: readonly string[];
  readonly join: SectionJoin;
  /**
   * For a span, the two endpoints exactly as written — `["103", "07"]` for
   * `§§ 103-07`. Absent for anything else.
   */
  readonly span?: readonly [string, string];
}

/** Bare digits, the only thing a section span may be written with. */
const DIGITS = /^\d+$/;

/**
 * Split the section text of a statute citation into the sections it names.
 *
 * `raw` is everything after the section symbol: `"501"`, `"1544, 1546"`,
 * `"103-107"`, `"240.10b-5"`.
 *
 * A hyphen is read as a span only when the sections on both sides are bare
 * digits. `240.10b-5` is Rule 10b-5, one section whose name contains a
 * hyphen; reading it as a span would have ReCite report a Bluebook error in a
 * correctly written securities citation.
 */
export function parseSections(raw: string | undefined): Sections | undefined {
  const text = raw?.trim();
  if (!text) return undefined;

  const items: string[] = [];
  const separators: string[] = [];

  let current = "";
  for (const ch of text) {
    if (ch === "," || DASHES.has(ch)) {
      items.push(current.trim());
      separators.push(ch === "," ? "," : "-");
      current = "";
      continue;
    }
    current += ch;
  }
  items.push(current.trim());

  if (items.some((item) => item === "")) return { items: [text], join: "single" };
  if (items.length === 1) return { items, join: "single" };

  // A hyphen between anything other than bare digits belongs to the section
  // name. Rejoin on those and try again with what is left.
  if (separators.some((sep) => sep === "-")) {
    const rejoined = rejoinNameHyphens(text, items, separators);
    if (rejoined) return rejoined;
  }

  const span = separators.every((sep) => sep === "-");
  if (span && items.length === 2) {
    return { items, join: "span", span: [items[0]!, items[1]!] };
  }

  return { items, join: separators.includes(",") ? "list" : "span" };
}

/**
 * Undo the splits made at hyphens that were part of a section name.
 *
 * Returns `undefined` when every hyphen was a genuine span separator, so the
 * caller can carry on with the split it already has.
 */
function rejoinNameHyphens(
  text: string,
  items: readonly string[],
  separators: readonly string[],
): Sections | undefined {
  const merged: string[] = [items[0]!];
  const kept: string[] = [];
  let changed = false;

  for (const [i, separator] of separators.entries()) {
    const next = items[i + 1]!;
    const previous = merged[merged.length - 1]!;

    if (separator === "-" && !(DIGITS.test(previous) && DIGITS.test(next))) {
      merged[merged.length - 1] = `${previous}-${next}`;
      changed = true;
      continue;
    }
    merged.push(next);
    kept.push(separator);
  }

  if (!changed) return undefined;
  if (merged.length === 1) return { items: [text.trim()], join: "single" };

  const span = kept.every((sep) => sep === "-");
  if (span && merged.length === 2) {
    return { items: merged, join: "span", span: [merged[0]!, merged[1]!] };
  }
  return { items: merged, join: kept.includes(",") ? "list" : "span" };
}

/**
 * Whether the end of a section span drops digits the Bluebook keeps.
 *
 * `103-07` does; `103-107` does not. Only bare-digit endpoints of the same
 * intended magnitude can be compared, so anything else answers `false`.
 */
export function dropsSectionDigits(from: string, to: string): boolean {
  if (!DIGITS.test(from) || !DIGITS.test(to)) return false;
  return to.length < from.length;
}

/** What `103-07` should have been written as: `103-107`. */
export function expandSectionEnd(from: string, to: string): string {
  if (!dropsSectionDigits(from, to)) return to;
  return from.slice(0, from.length - to.length) + to;
}
