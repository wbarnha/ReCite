/**
 * The editor, as a {@link DocumentHost}.
 *
 * `BrowserHost` edits a textarea by string surgery; `WordHost` edits Word's
 * document through a search. This edits a formatted document held in the page,
 * and the reason it is a third implementation rather than a branch inside the
 * first is that applying a correction here has to keep the marks — replacing
 * the whole value with a string would flatten every bold citation in the
 * document to fix a comma in one of them.
 *
 * Everything above this layer is unchanged. `useReCite` still calls
 * `read`/`apply`/`reveal` and still knows nothing about which surface it has.
 */

import type { Correction } from "@recite/core";

import type { ApplyOutcome, DocumentHost, RevealOutcome } from "../host.js";

import type { RichDocument } from "./model.js";

/** What the editor component exposes to the rest of the app. */
export interface EditorHandle {
  text(): string;
  document(): RichDocument;
  apply(corrections: readonly Correction[]): ApplyOutcome;
  /** `expected` is the text those offsets covered when the check ran. */
  reveal(start: number, end: number, expected?: string): RevealOutcome;
}

export class EditorHost implements DocumentHost {
  readonly kind = "browser" as const;
  readonly label = "Document";

  /**
   * A getter rather than the handle itself: the editor mounts and unmounts as
   * the surface changes, and a host holding a stale reference would silently
   * read the document that was open before.
   */
  constructor(private readonly handle: () => EditorHandle | null) {}

  read(): Promise<string> {
    return Promise.resolve(this.handle()?.text() ?? "");
  }

  apply(_text: string, corrections: readonly Correction[]): Promise<ApplyOutcome> {
    const editor = this.handle();
    if (!editor) return Promise.resolve({ applied: 0, skipped: corrections.length });
    return Promise.resolve(editor.apply(corrections));
  }

  /**
   * There is deliberately no `annotate` here.
   *
   * Word owns a document with somewhere to put a comment, so `WordHost` writes
   * them in. This surface paints them in the margin beside the page and writes
   * them into the file when it is saved — which is the same comment, arriving
   * by a different route. Implementing `annotate` to do nothing would put a
   * sentence in the status line that was not true.
   */
  reveal(text: string, start: number, end: number): Promise<RevealOutcome> {
    return Promise.resolve(
      this.handle()?.reveal(start, end, text.slice(start, end)) ?? {
        found: false,
        reason: "the editor is not open",
      },
    );
  }
}
