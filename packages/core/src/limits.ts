/**
 * The one hard limit on what the parser will accept.
 *
 * Every pattern in this package is linear in the length of its input — that is
 * asserted, pattern by pattern, in `packages/core/test/redos.test.ts`. Linear
 * is not the same as free: the parser runs on the UI thread, in a browser tab
 * or inside a Word task pane, and enough linear work still stops the pane
 * responding.
 *
 * So there is a ceiling, and passing it is an error rather than a truncation.
 * A checker that quietly examined the first few megabytes and reported a clean
 * document would be worse than one that refused: the reader would have no way
 * to tell a checked document from an unchecked one, and this is a tool people
 * use to decide whether a brief is safe to file.
 */

/**
 * Longest document the parser will accept, in UTF-16 code units.
 *
 * Eight million characters is roughly 1.3 million words, or something like
 * 2,500 pages of double-spaced text — far past any brief, and past most
 * appellate records. On the measured throughput of the full rule set this is
 * a few seconds of work, which is the point at which refusing is kinder than
 * continuing.
 */
export const MAX_INPUT_CHARS = 8_000_000;

/**
 * Raised when a document is longer than {@link MAX_INPUT_CHARS}.
 *
 * A distinct type rather than a bare `Error` so a caller can tell "this
 * document is too big" — which the user can act on by splitting it — from a
 * bug in the parser, which they cannot.
 */
export class InputTooLargeError extends Error {
  override readonly name = "InputTooLargeError";

  constructor(
    readonly length: number,
    readonly limit: number = MAX_INPUT_CHARS,
  ) {
    super(
      `Document is ${length.toLocaleString("en-US")} characters, over the ` +
        `${limit.toLocaleString("en-US")} character limit. ReCite checks the ` +
        "whole document or none of it, so that a clean report always means " +
        "the whole document was read. Split it and check the parts.",
    );
  }
}

/** Throw if `text` is longer than the parser will accept. */
export function assertWithinLimits(text: string): void {
  if (text.length > MAX_INPUT_CHARS) {
    throw new InputTooLargeError(text.length);
  }
}
