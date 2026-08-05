/**
 * Scoring how badly OCR mangled a document.
 *
 * A benchmark that reports only elapsed time will happily approve a change
 * that halves the runtime by reading half the characters. For a citation
 * checker that is the wrong direction to be wrong in: `tools/tessdata` already
 * documents choosing an eleven-megabyte language model over a three-megabyte
 * one because "a misread digit in a volume number is a wrong citation that
 * looks right". Anything that trades accuracy for speed has to be measured on
 * both axes or it cannot be judged at all.
 *
 * Two scores, because they answer different questions:
 *
 * - **Character similarity** against a known-good transcript, which says how
 *   much of the document survived.
 * - **Citation recall**, which says how much of the part ReCite actually reads
 *   survived. This is the one that matters: OCR damage in the middle of a
 *   paragraph costs nothing, and the same damage inside `181 F.3d 694` costs
 *   the finding.
 *
 * Deliberately free of any engine: it compares two strings. Swapping Scribe
 * for something else changes nothing here, which is the point — this is how
 * you would compare them.
 */

import { parse } from "@recite/core";

/** Normalised for comparison: case, whitespace and punctuation spacing. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Levenshtein distance, computed in O(min(a,b)) space.
 *
 * Bounded by `limit`: a transcript and an OCR run of a long filing are tens of
 * thousands of characters, and the full matrix is not worth allocating when
 * the answer past a certain distance is "completely different" either way.
 */
export function editDistance(a: string, b: string, limit = 100_000): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > limit) return limit;

  // Keep the shorter string on the axis we allocate for.
  if (a.length > b.length) [a, b] = [b, a];

  let previous = Array.from({ length: a.length + 1 }, (_, i) => i);
  let current = new Array<number>(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    current[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const substitution = previous[i - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[i] = Math.min(current[i - 1]! + 1, previous[i]! + 1, substitution);
    }
    [previous, current] = [current, previous];
  }

  return previous[a.length]!;
}

/** 1.0 for identical text, 0.0 for nothing in common. */
export function similarity(expected: string, actual: string): number {
  const a = normalise(expected);
  const b = normalise(actual);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return Math.max(0, 1 - editDistance(a, b) / longest);
}

export interface CitationAccuracy {
  /** Citations found in the known-good transcript. */
  readonly expected: number;
  /** How many of them survived recognition, matched by their text. */
  readonly recovered: number;
  /** Citations the run produced that the transcript does not contain. */
  readonly spurious: number;
  /** `recovered / expected`, or 1 when the transcript has none. */
  readonly recall: number;
  /** The ones that did not survive, for a failure message worth reading. */
  readonly lost: readonly string[];
}

/**
 * How many of a document's citations survived being read.
 *
 * Compared on the citation's own text with whitespace collapsed, not on span
 * offsets: OCR shifts every offset in the document, so comparing positions
 * would report total failure for a perfect read.
 */
export function citationAccuracy(expected: string, actual: string): CitationAccuracy {
  const key = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

  const wanted = parse(expected).citations.map((c) => key(c.text));
  const got = new Set(parse(actual).citations.map((c) => key(c.text)));

  const lost = wanted.filter((text) => !got.has(text));
  const recovered = wanted.length - lost.length;

  const wantedSet = new Set(wanted);
  const spurious = [...got].filter((text) => !wantedSet.has(text)).length;

  return {
    expected: wanted.length,
    recovered,
    spurious,
    recall: wanted.length === 0 ? 1 : recovered / wanted.length,
    lost,
  };
}
