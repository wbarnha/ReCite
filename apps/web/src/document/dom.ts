/**
 * The bridge between the model and a `contenteditable`.
 *
 * Reading is the hard half. A browser given `contenteditable` will produce
 * whatever markup its own editing commands felt like: `<b>` in one, a
 * `<span style="font-weight: 700">` in another, `<div>` instead of `<p>` for a
 * new line, an `&nbsp;` where a space was typed at the end of a run. So the
 * reader walks the tree and asks about *computed* meaning rather than matching
 * tag names — and normalises everything back to the three marks ReCite has.
 *
 * Writing is the easy half, and is done with `createElement` and
 * `createTextNode` rather than by assigning `innerHTML`. That is not a style
 * preference: the text being rendered is a document someone opened, it may
 * contain anything at all, and `react/no-danger` is an error in this
 * repository for exactly that reason.
 */

import type { RichDocument, RichParagraph, RichRun } from "./model.js";
import { mergeRuns, paragraphOffsets } from "./model.js";

/** Elements that end a paragraph when the browser produces them. */
const BLOCK = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6"]);

// ------------------------------------------------------------------ write ---

function runElement(run: RichRun, doc: Document): Node {
  let node: Node = doc.createTextNode(run.text);
  // Innermost first, so the nesting order matches what `toHtml` writes and a
  // round trip through either is stable.
  if (run.underline) node = wrap(doc, "u", node);
  if (run.italic) node = wrap(doc, "em", node);
  if (run.bold) node = wrap(doc, "strong", node);
  return node;
}

function wrap(doc: Document, tag: string, child: Node): Node {
  const element = doc.createElement(tag);
  element.appendChild(child);
  return element;
}

export function paragraphElement(paragraph: RichParagraph, doc: Document): HTMLElement {
  const element = doc.createElement("p");
  for (const run of paragraph.runs) {
    if (run.text) element.appendChild(runElement(run, doc));
  }
  // An empty `<p>` collapses to nothing and cannot be clicked into, so a blank
  // line in the document would be a line the caret can never reach.
  if (!element.firstChild) element.appendChild(doc.createElement("br"));
  return element;
}

/** Replace the contents of `host` with the document. */
export function render(host: HTMLElement, document_: RichDocument): void {
  const doc = host.ownerDocument;
  const fragment = doc.createDocumentFragment();
  for (const paragraph of document_.paragraphs) {
    fragment.appendChild(paragraphElement(paragraph, doc));
  }
  host.replaceChildren(fragment);
}

// ------------------------------------------------------------------- read ---

interface Marks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

const NONE: Marks = { bold: false, italic: false, underline: false };

/**
 * What an element adds to the marks in force inside it.
 *
 * Tag names first, then inline styles, because both appear: `execCommand`
 * emits `<b>` in Chromium and Firefox but a styled `<span>` when the selection
 * already sat inside one.
 */
function marksFor(element: HTMLElement, inherited: Marks): Marks {
  const tag = element.tagName;
  const style = element.style;
  const weight = style.fontWeight;

  return {
    bold:
      inherited.bold ||
      tag === "B" ||
      tag === "STRONG" ||
      weight === "bold" ||
      weight === "bolder" ||
      Number(weight) >= 600,
    italic:
      inherited.italic ||
      tag === "I" ||
      tag === "EM" ||
      style.fontStyle === "italic" ||
      style.fontStyle === "oblique",
    underline:
      inherited.underline ||
      tag === "U" ||
      style.textDecorationLine.includes("underline") ||
      style.textDecoration.includes("underline"),
  };
}

/**
 * Read a `contenteditable` back into the model.
 *
 * The document is a list of paragraphs, so the walk has to decide where one
 * ends. Two things end one: a block element closing, and a `<br>`. Everything
 * else contributes text.
 */
export function read(host: HTMLElement): RichDocument {
  const paragraphs: RichParagraph[] = [];
  let current: RichRun[] = [];

  const flush = (): void => {
    paragraphs.push({ runs: mergeRuns(current) });
    current = [];
  };

  const walk = (node: Node, marks: Marks): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 /* Text */) {
        // A browser writes a non-breaking space where a trailing one was
        // typed. It is not one in the document, and leaving it in would make a
        // citation containing it fail to match its own reporter.
        const text = (child.textContent ?? "").replace(/\xa0/g, " ");
        if (text) current.push({ text, ...active(marks) });
        continue;
      }
      if (child.nodeType !== 1 /* Element */) continue;

      const element = child as HTMLElement;
      if (element.tagName === "BR") {
        // A `<br>` that ends its parent is the filler which keeps an empty
        // paragraph clickable, and is not a line of its own — the enclosing
        // block will emit that paragraph as it closes. Only a `<br>` with
        // something after it is a real break.
        //
        // Getting this wrong read `<p><br></p>` as *two* paragraphs, which
        // put every offset after the first blank line one character out: the
        // findings then painted nothing and a jump landed nowhere. Blank lines
        // are in almost every real document, so it was wrong almost always.
        if (element.nextSibling) flush();
        continue;
      }

      const inner = marksFor(element, marks);
      if (BLOCK.has(element.tagName)) {
        // A block that is not the first thing in its parent starts a new
        // paragraph; whatever preceded it was one of its own.
        if (current.length > 0) flush();
        walk(element, inner);
        flush();
        continue;
      }
      walk(element, inner);
    }
  };

  walk(host, NONE);
  if (current.length > 0 || paragraphs.length === 0) flush();

  // A block walk emits a paragraph as it closes, so a host whose last child is
  // a `<p>` leaves one empty paragraph behind. Real trailing blank lines are
  // preserved; only that artefact is dropped.
  if (
    paragraphs.length > 1 &&
    paragraphs[paragraphs.length - 1]!.runs.length === 0 &&
    host.lastElementChild &&
    BLOCK.has(host.lastElementChild.tagName)
  ) {
    paragraphs.pop();
  }

  return { paragraphs };
}

function active(marks: Marks): Partial<Marks> {
  return {
    ...(marks.bold ? { bold: true } : {}),
    ...(marks.italic ? { italic: true } : {}),
    ...(marks.underline ? { underline: true } : {}),
  };
}

// ---------------------------------------------------------------- offsets ---

/**
 * A DOM `Range` for `[start, end)` of the document's plain text.
 *
 * This is the function that makes a finding computed against a string light up
 * the right words on screen. It walks the same paragraphs in the same order
 * the reader does, so the offsets it resolves are the offsets the engine used.
 */
export function rangeFor(
  host: HTMLElement,
  document_: RichDocument,
  start: number,
  end: number,
): Range | undefined {
  const offsets = paragraphOffsets(document_);
  const elements = Array.from(host.children).filter((child) =>
    BLOCK.has(child.tagName),
  );
  if (elements.length !== offsets.length) return undefined;

  const from = locate(elements, offsets, start);
  const to = locate(elements, offsets, end);
  if (!from || !to) return undefined;

  const range = host.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** The text node and offset inside it for a document offset. */
function locate(
  elements: readonly Element[],
  offsets: ReadonlyArray<{ readonly start: number; readonly end: number }>,
  offset: number,
): { node: Node; offset: number } | undefined {
  for (const [index, range] of offsets.entries()) {
    if (offset > range.end) continue;
    const element = elements[index];
    if (!element) return undefined;

    let remaining = offset - range.start;
    let last: { node: Node; offset: number } | undefined;

    for (const node of textNodes(element)) {
      const length = (node.textContent ?? "").length;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      last = { node, offset: length };
    }
    // An empty paragraph has no text node to point into; the element itself
    // with offset 0 is the position a browser would give.
    return last ?? { node: element, offset: 0 };
  }
  return undefined;
}

function* textNodes(root: Node): Generator<Node> {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) yield child;
    else if (child.nodeType === 1) yield* textNodes(child);
  }
}

/**
 * The document offset of a DOM position.
 *
 * The inverse of {@link rangeFor}, and it has to agree with it exactly: this
 * is what turns "what the user has selected" into the `[start, end)` a mark
 * command operates on.
 */
export function offsetOf(
  host: HTMLElement,
  node: Node,
  offset: number,
): number | undefined {
  const blocks = Array.from(host.children).filter((child) => BLOCK.has(child.tagName));

  let at = 0;
  for (const [index, block] of blocks.entries()) {
    if (index > 0) at += 1; // the newline between paragraphs

    if (node === block) {
      // A position expressed against the paragraph itself: count the text of
      // the children before it.
      let before = 0;
      for (const child of Array.from(block.childNodes).slice(0, offset)) {
        before += (child.textContent ?? "").length;
      }
      return at + before;
    }

    let seen = 0;
    let contains = false;
    for (const text of textNodes(block)) {
      if (text === node) {
        contains = true;
        seen += Math.min(offset, (text.textContent ?? "").length);
        break;
      }
      seen += (text.textContent ?? "").length;
    }
    if (contains) return at + seen;

    at += (block.textContent ?? "").length;
  }

  return undefined;
}

/** What the user has selected, as document offsets. */
export function selectionOffsets(
  host: HTMLElement,
): { start: number; end: number } | undefined {
  const selection = host.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;

  const range = selection.getRangeAt(0);
  if (!host.contains(range.commonAncestorContainer)) return undefined;

  const start = offsetOf(host, range.startContainer, range.startOffset);
  const end = offsetOf(host, range.endContainer, range.endOffset);
  if (start === undefined || end === undefined) return undefined;
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Put the caret, or the selection, back where it was after a re-render. */
export function selectOffsets(
  host: HTMLElement,
  document_: RichDocument,
  start: number,
  end: number,
): void {
  const range = rangeFor(host, document_, start, end);
  if (!range) return;
  const selection = host.ownerDocument.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}
