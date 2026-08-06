/**
 * Where the document comes from, and how edits get back into it.
 *
 * The web app edits a textarea it owns outright, so applying a fix is string
 * surgery. Word owns its document and exposes no character offsets, so edits
 * have to be expressed as "find this text and replace the Nth occurrence".
 * {@link DocumentHost} is the seam that lets one set of components drive both.
 */

import type { Correction } from "@recite/core";
import { applyCorrections } from "@recite/core";

import type { DocumentComment } from "./export/index.js";

export interface ApplyOutcome {
  readonly applied: number;
  readonly skipped: number;
  /** The document after editing, when the host can produce it. */
  readonly text?: string;
}

/**
 * Whether a jump to a citation actually landed.
 *
 * Reported rather than swallowed. Offsets come from the last check, and the
 * document may have been edited since — in Word it may have been edited by
 * somebody else, in another window. A click that silently does nothing reads
 * as a broken button; "that citation is not there any more" reads as what it
 * is, and tells the user to check again.
 */
export interface RevealOutcome {
  readonly found: boolean;
  readonly reason?: string;
}

export const REVEALED: RevealOutcome = { found: true };

export interface DocumentHost {
  readonly kind: "browser" | "word";
  /** Shown in the UI so the user knows what is being checked. */
  readonly label: string;
  read(): Promise<string>;
  apply(text: string, corrections: readonly Correction[]): Promise<ApplyOutcome>;
  /**
   * Jump to a span and select it.
   *
   * Every surface can do this, and each does it differently: a textarea has
   * offsets but no scrolling, the editor has a DOM range, and Word has neither
   * and has to search for the text instead.
   */
  reveal?(text: string, start: number, end: number): Promise<RevealOutcome>;
  /**
   * Write notes into the document as comments.
   *
   * Optional because not every host has somewhere to put one. Word does, and
   * that is the whole point of doing it there rather than in a report beside
   * the file. A plain textarea does not, so the web app carries its comments
   * into the saved `.docx` or `.odt` instead — see `export/comments.ts`.
   */
  annotate?(text: string, comments: readonly DocumentComment[]): Promise<ApplyOutcome>;
  /**
   * Whatever the user has selected, as text.
   *
   * Only used to prefill a report about a citation ReCite said nothing about —
   * the case where there is no finding to start from, and the reporter would
   * otherwise be retyping the citation. Optional, and a host that cannot
   * answer just leaves the field empty.
   */
  selection?(): Promise<string>;
}

// ------------------------------------------------------------------ browser --

/** Edits a string held in the page. */
export class BrowserHost implements DocumentHost {
  readonly kind = "browser" as const;
  readonly label = "Pasted text";

  constructor(
    private getText: () => string,
    private setText: (next: string) => void,
    /** Select the span and scroll it into view. See `textarea.ts`. */
    private select?: (start: number, end: number) => void,
    private getSelection?: () => string,
  ) {}

  selection(): Promise<string> {
    return Promise.resolve(this.getSelection?.() ?? "");
  }

  read(): Promise<string> {
    return Promise.resolve(this.getText());
  }

  apply(text: string, corrections: readonly Correction[]): Promise<ApplyOutcome> {
    const patch = applyCorrections(text, corrections);
    this.setText(patch.text);
    return Promise.resolve({
      applied: patch.applied.length,
      skipped: patch.skipped.length,
      text: patch.text,
    });
  }

  /**
   * Checked against the *live* text, not the text of the last check.
   *
   * The two are the same until somebody edits the document, and after that the
   * offsets describe a document that no longer exists. Scrolling confidently
   * to whatever now sits at those characters is worse than admitting the miss:
   * it points at an innocent citation and calls it the finding.
   */
  reveal(text: string, start: number, end: number): Promise<RevealOutcome> {
    const wanted = text.slice(start, end);
    if (!wanted) {
      return Promise.resolve({ found: false, reason: "there is nothing to jump to" });
    }
    if (this.getText().slice(start, end) !== wanted) {
      return Promise.resolve({
        found: false,
        reason: "the document has changed since the check — check it again",
      });
    }
    this.select?.(start, end);
    return Promise.resolve(REVEALED);
  }
}

// --------------------------------------------------------------------- Word --

/**
 * Reads and edits the open Word document through Office.js.
 *
 * Office.js has no notion of a character offset into the document body, so a
 * correction computed against the plain text has to be re-expressed as a
 * search. The awkward part is that the same citation often appears more than
 * once — counting how many identical strings precede the span is what keeps
 * the fix landing on the right one.
 */
export class WordHost implements DocumentHost {
  readonly kind = "word" as const;
  readonly label = "Word document";

  static isAvailable(): boolean {
    return (
      typeof Office !== "undefined" &&
      typeof Word !== "undefined" &&
      Office.context?.host === Office.HostType.Word
    );
  }

  async read(): Promise<string> {
    return Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      return body.text;
    });
  }

  async apply(text: string, corrections: readonly Correction[]): Promise<ApplyOutcome> {
    // Resolve every correction to a needle and an occurrence *before* editing:
    // once the first replacement lands, later offsets no longer describe the
    // document.
    const edits = corrections
      .map((correction) => ({
        needle: text.slice(correction.span.start, correction.span.end),
        replacement: correction.replacement,
        occurrence: countBefore(
          text,
          text.slice(correction.span.start, correction.span.end),
          correction.span.start,
        ),
      }))
      .filter((edit) => edit.needle.length > 0 && edit.needle.length <= 255);

    let applied = 0;

    await Word.run(async (context) => {
      for (const edit of edits) {
        const results = context.document.body.search(edit.needle, {
          matchCase: true,
          ignorePunct: false,
          ignoreSpace: false,
        });
        results.load("items");
        await context.sync();

        const target = results.items[edit.occurrence];
        if (!target) continue;

        target.insertText(edit.replacement, Word.InsertLocation.replace);
        applied++;
        await context.sync();
      }
    });

    return { applied, skipped: corrections.length - applied };
  }

  /**
   * Scroll Word to the citation and select it.
   *
   * The same "find the Nth occurrence" manoeuvre a correction uses, because
   * Office.js has no character offsets — and `Range.select()` is what makes
   * Word bring it on screen. The occurrence index is what keeps the jump on
   * the right citation when the same one appears several times.
   */
  async reveal(text: string, start: number, end: number): Promise<RevealOutcome> {
    const needle = text.slice(start, end);
    if (!needle) return { found: false, reason: "there is nothing to jump to" };
    if (needle.length > 255) {
      // Word's search limit. No citation comes close, but the guard is there.
      return { found: false, reason: "that span is too long for Word to search for" };
    }
    const occurrence = countBefore(text, needle, start);

    return Word.run(async (context) => {
      const results = context.document.body.search(needle, { matchCase: true });
      results.load("items");
      await context.sync();

      const target = results.items[occurrence];
      if (!target) {
        return {
          found: false,
          reason: "that citation is no longer in the document — check it again",
        };
      }
      target.select();
      await context.sync();
      return REVEALED;
    });
  }

  /**
   * Attach each note to its citation as a real Word comment.
   *
   * The same "find the Nth occurrence" manoeuvre a correction uses, for the
   * same reason: Office.js has no character offsets, and the same citation
   * often appears more than once.
   *
   * A comment is not an edit — it does not change a word of the document —
   * which is why it can be written on a check rather than held behind the
   * review gate that governs fixes.
   */
  async annotate(
    text: string,
    comments: readonly DocumentComment[],
  ): Promise<ApplyOutcome> {
    if (!WordHost.supportsComments()) {
      throw new Error(
        "This version of Word cannot add comments from an add-in (it needs the " +
          "WordApi 1.4 requirement set). Save the document from the web app " +
          "instead — the comments are written into the .docx.",
      );
    }

    const edits = comments
      .map((comment) => ({
        needle: text.slice(comment.span.start, comment.span.end),
        body: comment.text,
        occurrence: countBefore(
          text,
          text.slice(comment.span.start, comment.span.end),
          comment.span.start,
        ),
      }))
      .filter((edit) => edit.needle.length > 0 && edit.needle.length <= 255);

    let applied = 0;

    await Word.run(async (context) => {
      for (const edit of edits) {
        const results = context.document.body.search(edit.needle, {
          matchCase: true,
          ignorePunct: false,
          ignoreSpace: false,
        });
        results.load("items");
        await context.sync();

        const target = results.items[edit.occurrence];
        if (!target) continue;

        target.insertComment(edit.body);
        applied++;
        await context.sync();
      }
    });

    return { applied, skipped: comments.length - applied };
  }

  /**
   * Whether this Word can be told to insert a comment.
   *
   * Comments arrived in the WordApi 1.4 requirement set. Older builds — and
   * Word on the web in some tenants — simply do not have the call, and finding
   * that out by watching it throw halfway through a document is worse than
   * being told up front.
   */
  /** What is selected in the document, for prefilling a report. */
  async selection(): Promise<string> {
    return Word.run(async (context) => {
      const range = context.document.getSelection();
      range.load("text");
      await context.sync();
      return range.text ?? "";
    });
  }

  static supportsComments(): boolean {
    try {
      return Office.context.requirements.isSetSupported("WordApi", "1.4");
    } catch {
      return false;
    }
  }
}

/** How many identical copies of `needle` appear before `offset`. */
export function countBefore(text: string, needle: string, offset: number): number {
  if (!needle) return 0;
  let count = 0;
  let at = text.indexOf(needle);
  while (at !== -1 && at < offset) {
    count++;
    at = text.indexOf(needle, at + needle.length);
  }
  return count;
}
