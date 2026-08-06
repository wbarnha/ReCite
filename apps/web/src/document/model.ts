/**
 * A document with formatting in it, and the offsets to find a citation by.
 *
 * ReCite has always worked on plain text, and the packages still do: `parse`
 * takes a string, a `Span` is a pair of character offsets, and a `Correction`
 * is a replacement for one of those spans. None of that changes here.
 *
 * What changes is that the web app can now hold a document whose text carries
 * marks — bold, italic, underline — and every one of those offsets still has
 * to mean the same thing. So the model is defined by its relationship to the
 * plain text rather than the other way round:
 *
 * - {@link richToText} is the string the engine sees.
 * - A paragraph is a line of that string. The newline between two paragraphs
 *   counts as one character, exactly as it does in a textarea.
 * - {@link replaceRange} edits by those same offsets, keeping the marks.
 *
 * That invariant is what lets a finding computed against the text light up the
 * right words on screen, and a fix land on the right citation without flatting
 * the paragraph it was in.
 */

import type { Correction } from "@recite/core";
import { applyCorrections } from "@recite/core";

/** Formatting a run can carry. Presentational only; the text is the document. */
export interface RunMarks {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
}

/** A stretch of text with the same marks throughout. */
export interface RichRun extends RunMarks {
  readonly text: string;
}

export interface RichParagraph {
  readonly runs: readonly RichRun[];
}

export interface RichDocument {
  readonly paragraphs: readonly RichParagraph[];
}

export const MARK_NAMES = ["bold", "italic", "underline"] as const;
export type MarkName = (typeof MARK_NAMES)[number];

export const EMPTY_DOCUMENT: RichDocument = { paragraphs: [{ runs: [] }] };

// ------------------------------------------------------------------ text ---

export function richFromText(text: string): RichDocument {
  return {
    paragraphs: text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => ({ runs: line ? [{ text: line }] : [] })),
  };
}

export function paragraphText(paragraph: RichParagraph): string {
  return paragraph.runs.map((run) => run.text).join("");
}

export function richToText(document: RichDocument): string {
  return document.paragraphs.map(paragraphText).join("\n");
}

/**
 * Where each paragraph sits in the plain text.
 *
 * `end` is the offset of the newline that follows it — or of the end of the
 * document for the last one — so `[start, end)` is exactly the paragraph's
 * own characters.
 */
export function paragraphOffsets(
  document: RichDocument,
): Array<{ readonly start: number; readonly end: number }> {
  const offsets: Array<{ start: number; end: number }> = [];
  let at = 0;
  for (const paragraph of document.paragraphs) {
    const length = paragraphText(paragraph).length;
    offsets.push({ start: at, end: at + length });
    at += length + 1; // the newline
  }
  return offsets;
}

// ------------------------------------------------------------------ runs ---

export function marksOf(run: RunMarks): RunMarks {
  return {
    ...(run.bold ? { bold: true } : {}),
    ...(run.italic ? { italic: true } : {}),
    ...(run.underline ? { underline: true } : {}),
  };
}

export function sameMarks(a: RunMarks, b: RunMarks): boolean {
  return MARK_NAMES.every((mark) => Boolean(a[mark]) === Boolean(b[mark]));
}

/**
 * Drop empty runs and join neighbours that are formatted the same.
 *
 * Not cosmetic. A contenteditable produces a fresh element for every keystroke
 * that lands on a boundary, so without this a paragraph someone typed into
 * accumulates hundreds of one-character runs — which then become hundreds of
 * `<w:r>` elements in the saved `.docx`.
 */
export function mergeRuns(runs: readonly RichRun[]): RichRun[] {
  const out: RichRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, run)) {
      out[out.length - 1] = { ...marksOf(last), text: last.text + run.text };
      continue;
    }
    out.push({ ...marksOf(run), text: run.text });
  }
  return out;
}

/** The runs covering `[from, to)` of a paragraph's own text. */
export function sliceRuns(
  runs: readonly RichRun[],
  from: number,
  to: number,
): RichRun[] {
  const out: RichRun[] = [];
  let at = 0;
  for (const run of runs) {
    const start = at;
    const end = at + run.text.length;
    at = end;
    if (end <= from || start >= to) continue;
    out.push({
      ...marksOf(run),
      text: run.text.slice(
        Math.max(0, from - start),
        Math.min(run.text.length, to - start),
      ),
    });
  }
  return mergeRuns(out);
}

/**
 * The marks text inserted at `offset` should inherit.
 *
 * The run *containing* the offset, or the one that ends at it — which is what
 * a word processor does, and what makes rewriting `119 S.Ct. 662` inside a
 * bold citation give back a bold citation.
 */
export function marksAt(runs: readonly RichRun[], offset: number): RunMarks {
  let at = 0;
  let previous: RunMarks = {};
  for (const run of runs) {
    const end = at + run.text.length;
    if (offset < end) return marksOf(run);
    previous = marksOf(run);
    at = end;
  }
  return previous;
}

// ----------------------------------------------------------------- edits ---

/**
 * Replace `[start, end)` of the document's text, keeping the formatting.
 *
 * The replacement is plain, and inherits the marks in force where it lands.
 * A range that crosses a paragraph break joins the paragraphs, and a
 * replacement containing newlines splits one — both of which follow from the
 * offsets meaning what they mean, rather than being special cases.
 */
export function replaceRange(
  document: RichDocument,
  start: number,
  end: number,
  replacement: string,
): RichDocument {
  const paragraphs = document.paragraphs;
  if (paragraphs.length === 0) return richFromText(replacement);

  const offsets = paragraphOffsets(document);
  const first = indexAt(offsets, start);
  const last = indexAt(offsets, end);

  const head = sliceRuns(paragraphs[first]!.runs, 0, start - offsets[first]!.start);
  const tail = sliceRuns(
    paragraphs[last]!.runs,
    end - offsets[last]!.start,
    Number.MAX_SAFE_INTEGER,
  );
  const marks = marksAt(paragraphs[first]!.runs, start - offsets[first]!.start);

  const lines = replacement.replace(/\r\n?/g, "\n").split("\n");
  const middle: RichParagraph[] = lines.map((line) => ({
    runs: line ? [{ ...marks, text: line }] : [],
  }));

  middle[0] = { runs: mergeRuns([...head, ...middle[0]!.runs]) };
  const lastMiddle = middle.length - 1;
  middle[lastMiddle] = { runs: mergeRuns([...middle[lastMiddle]!.runs, ...tail]) };

  return {
    paragraphs: [
      ...paragraphs.slice(0, first),
      ...middle,
      ...paragraphs.slice(last + 1),
    ],
  };
}

/** The paragraph an offset falls in; the last one when it is past the end. */
function indexAt(
  offsets: ReadonlyArray<{ readonly start: number; readonly end: number }>,
  offset: number,
): number {
  for (const [index, range] of offsets.entries()) {
    if (offset <= range.end) return index;
  }
  return offsets.length - 1;
}

export interface RichPatch {
  readonly document: RichDocument;
  readonly applied: readonly Correction[];
  readonly skipped: ReadonlyArray<readonly [Correction, string]>;
  readonly changed: boolean;
}

/**
 * Apply corrections to a formatted document.
 *
 * Which corrections are *allowed* is decided by `@recite/core` against the
 * plain text, so a formatted document and a plain one accept and refuse
 * exactly the same set — two rules fighting over one citation still produce a
 * reported refusal rather than nonsense. Only the application is done here,
 * back-to-front for the same reason `applyCorrections` does it that way.
 */
export function applyCorrectionsRich(
  document: RichDocument,
  corrections: readonly Correction[],
): RichPatch {
  const patch = applyCorrections(richToText(document), corrections);

  let next = document;
  for (const correction of [...patch.applied].sort(
    (a, b) => b.span.start - a.span.start,
  )) {
    next = replaceRange(
      next,
      correction.span.start,
      correction.span.end,
      correction.replacement,
    );
  }

  return {
    document: next,
    applied: patch.applied,
    skipped: patch.skipped,
    changed: patch.changed,
  };
}

// ----------------------------------------------------------------- marks ---

/**
 * Turn a mark on or off across `[start, end)`.
 *
 * The rule a word processor uses: if every character in the selection already
 * carries the mark, the command removes it; otherwise it adds it. Anything
 * else makes a toolbar button feel broken on a mixed selection.
 */
export function toggleMark(
  document: RichDocument,
  start: number,
  end: number,
  mark: MarkName,
): RichDocument {
  if (end <= start) return document;
  const on = !hasMarkThroughout(document, start, end, mark);

  const offsets = paragraphOffsets(document);
  const paragraphs = document.paragraphs.map((paragraph, index) => {
    const range = offsets[index]!;
    if (range.end <= start || range.start >= end) return paragraph;

    const from = Math.max(0, start - range.start);
    const to = Math.min(paragraphText(paragraph).length, end - range.start);

    return {
      runs: mergeRuns([
        ...sliceRuns(paragraph.runs, 0, from),
        ...sliceRuns(paragraph.runs, from, to).map((run) => ({
          ...marksOf(run),
          ...{ [mark]: on },
          text: run.text,
        })),
        ...sliceRuns(paragraph.runs, to, Number.MAX_SAFE_INTEGER),
      ]),
    };
  });

  return { paragraphs };
}

export function hasMarkThroughout(
  document: RichDocument,
  start: number,
  end: number,
  mark: MarkName,
): boolean {
  const offsets = paragraphOffsets(document);
  let sawAny = false;

  for (const [index, range] of offsets.entries()) {
    if (range.end <= start || range.start >= end) continue;
    const from = Math.max(0, start - range.start);
    const to = Math.min(range.end - range.start, end - range.start);
    for (const run of sliceRuns(document.paragraphs[index]!.runs, from, to)) {
      sawAny = true;
      if (!run[mark]) return false;
    }
  }

  return sawAny;
}
