/**
 * The document model behind the editor.
 *
 * One invariant carries the whole feature: **the plain text of a formatted
 * document is the string the engine sees, and every offset means the same
 * thing in both.** A finding at `[36, 48)` has to light up the same twelve
 * characters whether the document is a textarea's value or a page with bold in
 * it, and a fix aimed at those offsets has to land there.
 *
 * The DOM half of the editor is exercised in `tools/test/browser.test.ts`,
 * against a real browser. Reading a `contenteditable` is precisely the sort of
 * thing a fake DOM would agree with and a real one would not.
 */

import type { Correction } from "@recite/core";
import { parse } from "@recite/core";
import { describe, expect, it } from "vitest";

import {
  applyCorrectionsRich,
  hasMarkThroughout,
  marksAt,
  mergeRuns,
  paragraphOffsets,
  replaceRange,
  richFromText,
  richToText,
  sliceRuns,
  toggleMark,
  type RichDocument,
} from "../src/document/model.js";

const TEXT = [
  "The pleading standard is set out in Iqbal, 556 U.S. 662, 678 (2009).",
  "",
  "See also Twombly, 550 U.S. 544, 570 (2007).",
].join("\n");

const fix = (start: number, end: number, replacement: string): Correction => ({
  span: { start, end },
  replacement,
  safety: "safe",
  description: "test",
});

/** `The <b>pleading</b> standard` — one paragraph, three runs. */
const MIXED: RichDocument = {
  paragraphs: [
    {
      runs: [{ text: "The " }, { text: "pleading", bold: true }, { text: " standard" }],
    },
  ],
};

describe("the text is the document", () => {
  it("round-trips a plain document", () => {
    expect(richToText(richFromText(TEXT))).toBe(TEXT);
  });

  it("keeps a blank line as a paragraph with nothing in it", () => {
    const document = richFromText("a\n\nb");
    expect(document.paragraphs).toHaveLength(3);
    expect(document.paragraphs[1]!.runs).toEqual([]);
    expect(richToText(document)).toBe("a\n\nb");
  });

  it("normalises the line endings a Windows file arrives with", () => {
    expect(richToText(richFromText("a\r\nb\rc"))).toBe("a\nb\nc");
  });

  it("counts the newline between paragraphs, exactly as a textarea does", () => {
    const document = richFromText("abc\nde");
    expect(paragraphOffsets(document)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ]);
  });

  it("finds a citation at the same offsets a plain string would", () => {
    // The claim the whole editor rests on. If these ever disagree, a finding
    // lights up the wrong words and a fix corrupts an unrelated citation.
    const document = richFromText(TEXT);
    const [citation] = parse(richToText(document)).citations;
    expect(TEXT.slice(citation!.span.start, citation!.span.end)).toBe("556 U.S. 662");
  });
});

describe("runs", () => {
  it("joins neighbours that are formatted the same", () => {
    // A contenteditable produces a fresh element per keystroke on a boundary,
    // so without this a typed paragraph becomes hundreds of one-character runs
    // — and hundreds of `<w:r>` elements in the saved .docx.
    expect(mergeRuns([{ text: "ab" }, { text: "cd" }])).toEqual([{ text: "abcd" }]);
    expect(
      mergeRuns([{ text: "ab", bold: true }, { text: "cd" }]).map((r) => r.text),
    ).toEqual(["ab", "cd"]);
  });

  it("drops empty runs rather than writing them out", () => {
    expect(mergeRuns([{ text: "" }, { text: "a" }, { text: "" }])).toEqual([
      { text: "a" },
    ]);
  });

  it("slices across a run boundary and keeps each side's marks", () => {
    const runs = sliceRuns(MIXED.paragraphs[0]!.runs, 2, 7);
    expect(runs).toEqual([{ text: "e " }, { text: "ple", bold: true }]);
  });

  it("inherits the marks in force where an insertion lands", () => {
    const runs = MIXED.paragraphs[0]!.runs;
    expect(marksAt(runs, 0)).toEqual({});
    expect(marksAt(runs, 6)).toEqual({ bold: true });
    // At the end of the last run, which is what a word processor does.
    expect(marksAt(runs, 21)).toEqual({});
  });
});

describe("replacing a range", () => {
  it("edits by the offsets of the plain text", () => {
    const document = replaceRange(richFromText("119 S.Ct. 662"), 4, 9, "S. Ct.");
    expect(richToText(document)).toBe("119 S. Ct. 662");
  });

  it("keeps the formatting of a citation it rewrites", () => {
    // The reason the editor cannot just replace its own value with a string:
    // fixing a comma would flatten every bold citation in the document.
    const bold: RichDocument = {
      paragraphs: [{ runs: [{ text: "119 S.Ct. 662", bold: true }] }],
    };
    const document = replaceRange(bold, 4, 9, "S. Ct.");
    expect(document.paragraphs[0]!.runs).toEqual([
      { bold: true, text: "119 S. Ct. 662" },
    ]);
  });

  it("leaves the text either side of a formatted run alone", () => {
    const document = replaceRange(MIXED, 4, 12, "PLEADING");
    expect(richToText(document)).toBe("The PLEADING standard");
    expect(document.paragraphs[0]!.runs).toEqual([
      { text: "The " },
      { bold: true, text: "PLEADING" },
      { text: " standard" },
    ]);
  });

  it("joins two paragraphs when the range crosses the break", () => {
    const document = replaceRange(richFromText("first\nsecond"), 3, 8, "-");
    expect(richToText(document)).toBe("fir-cond");
    expect(document.paragraphs).toHaveLength(1);
  });

  it("splits a paragraph when the replacement contains a newline", () => {
    const document = replaceRange(richFromText("ab cd"), 2, 3, "\n");
    expect(richToText(document)).toBe("ab\ncd");
    expect(document.paragraphs).toHaveLength(2);
  });

  it("handles an insertion, which is a range of no length", () => {
    expect(richToText(replaceRange(richFromText("ac"), 1, 1, "b"))).toBe("abc");
  });
});

describe("applying corrections", () => {
  it("agrees with the plain-text path about what it applied", () => {
    const document = richFromText("119 S.Ct. 662 and 20 L.Ed.2d 835");
    const patch = applyCorrectionsRich(document, [
      fix(4, 9, "S. Ct."),
      fix(21, 28, "L. Ed. 2d"),
    ]);
    expect(patch.applied).toHaveLength(2);
    expect(richToText(patch.document)).toBe("119 S. Ct. 662 and 20 L. Ed. 2d 835");
  });

  it("refuses two fixes that overlap, and says which", () => {
    // Decided by `@recite/core` against the text, so a formatted document and
    // a plain one accept and refuse exactly the same set.
    const patch = applyCorrectionsRich(richFromText("abcdefgh"), [
      fix(0, 4, "W"),
      fix(2, 6, "X"),
    ]);
    expect(patch.applied).toHaveLength(1);
    expect(patch.skipped).toHaveLength(1);
    expect(patch.skipped[0]![1]).toMatch(/overlaps/);
  });

  it("applies back-to-front, so later offsets stay valid", () => {
    const patch = applyCorrectionsRich(richFromText("aaa bbb ccc"), [
      fix(0, 3, "1"),
      fix(8, 11, "3"),
    ]);
    expect(richToText(patch.document)).toBe("1 bbb 3");
  });

  it("changes nothing when there is nothing to change", () => {
    const patch = applyCorrectionsRich(richFromText("abc"), []);
    expect(patch.changed).toBe(false);
    expect(richToText(patch.document)).toBe("abc");
  });
});

describe("marks", () => {
  it("adds a mark across a range", () => {
    const document = toggleMark(richFromText("abcdef"), 2, 4, "bold");
    expect(document.paragraphs[0]!.runs).toEqual([
      { text: "ab" },
      { bold: true, text: "cd" },
      { text: "ef" },
    ]);
  });

  it("removes it when every character already has it", () => {
    const bold = toggleMark(richFromText("abcdef"), 0, 6, "italic");
    expect(hasMarkThroughout(bold, 0, 6, "italic")).toBe(true);
    expect(richToText(toggleMark(bold, 0, 6, "italic"))).toBe("abcdef");
    expect(toggleMark(bold, 0, 6, "italic").paragraphs[0]!.runs).toEqual([
      { text: "abcdef" },
    ]);
  });

  it("adds it to the whole selection when only part of it has it", () => {
    // Anything else makes the toolbar button feel broken on a mixed
    // selection: the first press would clear it from half the words.
    const partly = toggleMark(richFromText("abcdef"), 0, 3, "bold");
    const all = toggleMark(partly, 0, 6, "bold");
    expect(hasMarkThroughout(all, 0, 6, "bold")).toBe(true);
  });

  it("spans paragraphs", () => {
    const document = toggleMark(richFromText("one\ntwo"), 1, 6, "underline");
    expect(document.paragraphs[0]!.runs).toEqual([
      { text: "o" },
      { underline: true, text: "ne" },
    ]);
    expect(document.paragraphs[1]!.runs).toEqual([
      { underline: true, text: "tw" },
      { text: "o" },
    ]);
  });

  it("leaves the text untouched, whatever it does to the marks", () => {
    expect(richToText(toggleMark(richFromText(TEXT), 5, 40, "bold"))).toBe(TEXT);
  });

  it("does nothing for an empty selection", () => {
    const document = richFromText("abc");
    expect(toggleMark(document, 2, 2, "bold")).toBe(document);
    expect(hasMarkThroughout(document, 2, 2, "bold")).toBe(false);
  });
});
