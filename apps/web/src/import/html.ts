/**
 * Text out of an HTML document.
 *
 * Word's "Save as Web Page" and most PDF-to-HTML converters produce these, so
 * it is a common way a brief arrives. The same tag scanner used for the office
 * formats does the work — `DOMParser` would also work in a browser, but not in
 * the tests, and this keeps one implementation to reason about.
 */

import { scan } from "./xml.js";

/** Elements whose content is code or styling rather than prose. */
const NON_TEXT = new Set(["script", "style", "head", "title", "noscript", "template"]);

/** Elements that end a line of prose. */
const BLOCK = new Set([
  "p",
  "div",
  "br",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "section",
  "article",
  "footer",
  "header",
  "table",
  "pre",
]);

export function readHtml(source: string): string {
  const out: string[] = [];
  // A counter rather than a flag: `<style>` inside `<head>` must not re-enable
  // text when the inner element closes.
  let suppressed = 0;

  for (const node of scan(source)) {
    switch (node.kind) {
      case "open":
        if (NON_TEXT.has(node.name)) suppressed++;
        // `br` is void and usually written `<br>`, so it has to break here.
        // Other blocks break on close only: breaking on both would put a
        // blank line between every pair of paragraphs.
        else if (node.name === "br") out.push("\n");
        break;

      case "close":
        if (NON_TEXT.has(node.name)) suppressed = Math.max(0, suppressed - 1);
        else if (BLOCK.has(node.name)) out.push("\n");
        break;

      case "self-closing":
        if (BLOCK.has(node.name)) out.push("\n");
        break;

      case "text":
        if (suppressed === 0) out.push(node.text);
        break;
    }
  }

  return (
    out
      .join("")
      .replace(/\r\n?/g, "\n")
      // HTML collapses runs of whitespace; a document that does not do the
      // same arrives full of the indentation of its own source.
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 1024).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}
