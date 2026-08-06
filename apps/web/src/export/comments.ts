/**
 * Anchoring a note to a span of the document.
 *
 * A finding in the app is a row in a panel; a note in a saved `.docx` is a
 * comment in the margin, next to the citation it is about, and it survives
 * being emailed to a partner who has never heard of ReCite. That is the whole
 * point of writing them into the file rather than into a report beside it.
 *
 * This module knows nothing about CourtListener, or about citations. It takes
 * spans and strings and works out where the markers go, which is what lets one
 * implementation serve both office formats — and would serve a third.
 */

import type { Span } from "@recite/core";

export interface DocumentComment {
  /** Half-open character range in the document text. */
  readonly span: Span;
  /** The comment body. Newlines become paragraphs in the comment bubble. */
  readonly text: string;
  readonly author?: string;
  readonly initials?: string;
}

export const COMMENT_AUTHOR = "ReCite";
export const COMMENT_INITIALS = "RC";

/** One piece of a paragraph: text, or a marker that opens or closes a range. */
export type CommentChunk =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "start"; readonly id: number }
  | { readonly kind: "end"; readonly id: number };

export interface CommentedParagraph {
  readonly chunks: readonly CommentChunk[];
}

/**
 * Split the document into paragraphs with the comment markers interleaved.
 *
 * Both office formats express a comment the same way — a marker where the
 * range opens, a marker where it closes, and the body somewhere else — so the
 * awkward part is identical for both and is done once, here.
 *
 * A comment whose range crosses a paragraph break opens in one paragraph and
 * closes in another, which both formats allow. A zero-length range is dropped:
 * there is nothing for a reader to highlight, and Word draws it as a comment
 * on the whole paragraph, which is not what was asked for.
 */
export function layoutComments(
  text: string,
  comments: readonly DocumentComment[],
): CommentedParagraph[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // Numbered after dropping the empty ones, so an id is an index into
  // `anchoredComments(...)` — which is the list the bodies are written from.
  const anchored = anchoredComments(comments).map((comment, id) => ({
    id,
    ...comment,
  }));

  const paragraphs: CommentedParagraph[] = [];
  let offset = 0;

  for (const line of lines) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1; // the newline that separated this line from the next

    /** Boundaries inside this paragraph, in the order they must be written. */
    const marks: Array<{ at: number; chunk: CommentChunk; rank: number }> = [];

    for (const comment of anchored) {
      // `[start, end)` for an opening marker and `(start, end]` for a closing
      // one, so a range that ends exactly at a paragraph break closes here
      // rather than opening the next paragraph with a stray marker.
      if (comment.span.start >= start && comment.span.start < end) {
        marks.push({
          at: comment.span.start,
          chunk: { kind: "start", id: comment.id },
          // Closing markers come first at a shared offset, so two adjacent
          // comments nest as `…end][start…` rather than overlapping.
          rank: 1,
        });
      }
      if (comment.span.end > start && comment.span.end <= end) {
        marks.push({
          at: comment.span.end,
          chunk: { kind: "end", id: comment.id },
          rank: 0,
        });
      }
    }

    marks.sort((a, b) => a.at - b.at || a.rank - b.rank);

    const chunks: CommentChunk[] = [];
    let cursor = start;
    for (const mark of marks) {
      if (mark.at > cursor) {
        chunks.push({ kind: "text", text: text.slice(cursor, mark.at) });
        cursor = mark.at;
      }
      chunks.push(mark.chunk);
    }
    if (cursor < end) chunks.push({ kind: "text", text: text.slice(cursor, end) });

    paragraphs.push({ chunks });
  }

  return paragraphs;
}

/** The comment bodies, in the order the markers refer to them. */
export function anchoredComments(
  comments: readonly DocumentComment[],
): DocumentComment[] {
  return comments.filter((comment) => comment.span.end > comment.span.start);
}
