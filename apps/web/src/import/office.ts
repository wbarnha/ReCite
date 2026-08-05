/**
 * Text out of the two ZIP-and-XML office formats: `.docx` and `.odt`.
 *
 * They need separate extractors, which is easy to miss because both are "ZIP
 * full of XML". OOXML wraps every span of text in a `<w:t>` element, so the
 * reader captures text only inside one. ODF puts text directly inside
 * `<text:p>`, with no equivalent wrapper — so a reader written for OOXML and
 * pointed at an ODT captures nothing at all and returns an empty document.
 *
 * Both are read for prose only. Styling, images, comments and tracked changes
 * are dropped; ReCite works on the text of citations.
 *
 * One detail matters more than it looks: a paragraph must become a newline. A
 * citation check reads `Id.` as referring to whatever came before it, so a
 * document flattened into one long line changes which citations look adjacent.
 */

import { readZipText, ZipError } from "./zip.js";
import { scan } from "./xml.js";

const DOCX_BODY = "word/document.xml";
const ODT_BODY = "content.xml";

/** Elements that end a line in either format. */
const PARAGRAPH = new Set(["p", "h"]);

/**
 * OOXML: text lives in `<w:t>`, `<w:tab>` and `<w:br>` are literal whitespace,
 * and everything else is formatting.
 */
export function textFromDocx(xml: string): string {
  const out: string[] = [];
  let depth = 0;

  for (const node of scan(xml)) {
    switch (node.kind) {
      case "open":
        if (node.name === "t") depth++;
        break;

      case "close":
        if (node.name === "t") depth = Math.max(0, depth - 1);
        else if (PARAGRAPH.has(node.name)) out.push("\n");
        break;

      case "self-closing":
        if (node.name === "tab") out.push("\t");
        else if (node.name === "br" || node.name === "cr") out.push("\n");
        // Word writes an empty paragraph as `<w:p/>`. Without this every
        // blank line in the document silently disappears.
        else if (PARAGRAPH.has(node.name)) out.push("\n");
        break;

      case "text":
        if (depth > 0) out.push(node.text);
        break;
    }
  }

  return tidy(out.join(""));
}

/**
 * ODF: text is direct content of `<text:p>` and `<text:span>`, so the reader
 * keeps everything except the parts that are not prose.
 */
const ODT_SKIPPED = new Set([
  "annotation",
  "tracked-changes",
  "note-body",
  "binary-data",
  "forms",
  "automatic-styles",
  "styles",
  "font-face-decls",
  "scripts",
  "meta",
]);

export function textFromOdt(xml: string): string {
  const out: string[] = [];
  let suppressed = 0;

  for (const node of scan(xml)) {
    switch (node.kind) {
      case "open":
        if (ODT_SKIPPED.has(node.name)) suppressed++;
        break;

      case "close":
        if (ODT_SKIPPED.has(node.name)) suppressed = Math.max(0, suppressed - 1);
        else if (PARAGRAPH.has(node.name)) out.push("\n");
        break;

      case "self-closing":
        if (suppressed > 0) break;
        // ODF encodes runs of spaces as `<text:s/>` and tabs as `<text:tab/>`.
        if (node.name === "s") out.push(" ");
        else if (node.name === "tab") out.push("\t");
        else if (node.name === "line-break") out.push("\n");
        else if (PARAGRAPH.has(node.name)) out.push("\n");
        break;

      case "text":
        if (suppressed === 0) out.push(node.text);
        break;
    }
  }

  return tidy(out.join(""));
}

/**
 * Normalise line endings and collapse the blank lines that fall out of empty
 * paragraphs — but keep one, because a blank line is meaningful structure.
 */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function bodyOf(
  buffer: ArrayBuffer,
  path: string,
  label: string,
  extract: (xml: string) => string,
): Promise<string> {
  const xml = await readZipText(buffer, path);
  if (xml === undefined) {
    throw new ZipError(
      `This does not look like a ${label} file: it has no ${path}. ` +
        "If it was renamed from another format, convert it properly first.",
    );
  }
  return extract(xml);
}

export function readDocx(buffer: ArrayBuffer): Promise<string> {
  return bodyOf(buffer, DOCX_BODY, ".docx", textFromDocx);
}

export function readOdt(buffer: ArrayBuffer): Promise<string> {
  return bodyOf(buffer, ODT_BODY, ".odt", textFromOdt);
}
