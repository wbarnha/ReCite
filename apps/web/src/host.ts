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

export interface DocumentHost {
  readonly kind: "browser" | "word";
  /** Shown in the UI so the user knows what is being checked. */
  readonly label: string;
  read(): Promise<string>;
  apply(text: string, corrections: readonly Correction[]): Promise<ApplyOutcome>;
  /** Draw the user's attention to a span. Optional; Word can, a textarea can too. */
  reveal?(text: string, start: number, end: number): Promise<void>;
  /**
   * Write notes into the document as comments.
   *
   * Optional because not every host has somewhere to put one. Word does, and
   * that is the whole point of doing it there rather than in a report beside
   * the file. A plain textarea does not, so the web app carries its comments
   * into the saved `.docx` or `.odt` instead — see `export/comments.ts`.
   */
  annotate?(text: string, comments: readonly DocumentComment[]): Promise<ApplyOutcome>;
}

// ------------------------------------------------------------------ browser --

/** Edits a string held in the page. */
export class BrowserHost implements DocumentHost {
  readonly kind = "browser" as const;
  readonly label = "Pasted text";

  constructor(
    private getText: () => string,
    private setText: (next: string) => void,
    private select?: (start: number, end: number) => void,
  ) {}

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

  reveal(_text: string, start: number, end: number): Promise<void> {
    this.select?.(start, end);
    return Promise.resolve();
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

  async reveal(text: string, start: number, end: number): Promise<void> {
    const needle = text.slice(start, end);
    if (!needle || needle.length > 255) return;
    const occurrence = countBefore(text, needle, start);

    await Word.run(async (context) => {
      const results = context.document.body.search(needle, { matchCase: true });
      results.load("items");
      await context.sync();

      const target = results.items[occurrence];
      if (!target) return;
      target.select();
      await context.sync();
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
