/**
 * Editing documents by span, without ever corrupting one.
 *
 * Corrections arrive from independent rules and refer to offsets in the
 * *original* text. Applying them in document order would invalidate every
 * offset after the first edit, and two rules that both want to rewrite the
 * same citation would silently produce nonsense.
 *
 * {@link applyCorrections} therefore applies edits back-to-front and refuses
 * any correction that overlaps one it already accepted, reporting the rejects
 * instead of dropping them.
 */

import type { Correction, Span } from "./model.js";
import { sliceSpan, spansOverlap } from "./model.js";

export interface PatchResult {
  readonly text: string;
  readonly applied: readonly Correction[];
  /** `[correction, reason]` for every edit that was not applied. */
  readonly skipped: ReadonlyArray<readonly [Correction, string]>;
  readonly changed: boolean;
}

export function applyCorrections(
  text: string,
  corrections: readonly Correction[],
): PatchResult {
  const ordered = [...corrections].sort(
    (a, b) => a.span.start - b.span.start || a.span.end - b.span.end,
  );

  const applied: Correction[] = [];
  const skipped: Array<readonly [Correction, string]> = [];

  for (const correction of ordered) {
    if (correction.span.end > text.length) {
      skipped.push([correction, "span extends past end of document"]);
      continue;
    }
    if (sliceSpan(text, correction.span) === correction.replacement) {
      skipped.push([correction, "replacement is identical to source"]);
      continue;
    }
    // Decide in document order so the outcome never depends on which rule
    // happened to run first.
    const clash = applied.find((a) => spansOverlap(a.span, correction.span));
    if (clash) {
      skipped.push([
        correction,
        `overlaps an earlier fix at [${clash.span.start}, ${clash.span.end})`,
      ]);
      continue;
    }
    applied.push(correction);
  }

  let patched = text;
  for (const correction of [...applied].sort((a, b) => b.span.start - a.span.start)) {
    patched =
      patched.slice(0, correction.span.start) +
      correction.replacement +
      patched.slice(correction.span.end);
  }

  return { text: patched, applied, skipped, changed: applied.length > 0 };
}

/** One line of context around a span, for display. */
export function snippet(text: string, s: Span, width = 72): string {
  const start = Math.max(0, s.start - Math.floor(width / 2));
  const end = Math.min(text.length, s.end + Math.floor(width / 2));
  const fragment = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${fragment}${end < text.length ? "…" : ""}`;
}

/**
 * A minimal line-level diff, good enough to show what a fix changed.
 *
 * Deliberately not a full Myers diff: the output is read by a human comparing
 * a handful of edited lines, and pulling in a diff library for that would be
 * more dependency than the job needs.
 */
export function lineDiff(before: string, after: string): string {
  if (before === after) return "";

  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [];

  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (left !== undefined) out.push(`- ${left}`);
    if (right !== undefined) out.push(`+ ${right}`);
  }

  return out.join("\n");
}
