/**
 * Writing `.docx` and `.odt`.
 *
 * Both are the minimum a conforming reader needs and no more. ReCite still
 * does not read the formatting of a document you open — it works on the text
 * of citations — so nothing here invents styling. What it does carry back out
 * is what the document actually has:
 *
 * - **The text**, one paragraph per line, as it always did.
 * - **The marks you applied in the editor** — bold, italic, underline. Losing
 *   those on save would make the editor a toy.
 * - **Comments**, when ReCite has pulled the passage a pin cite points at.
 *   `word/comments.xml` for OOXML, `<office:annotation>` for ODF, so the note
 *   lands in the margin next to the citation and survives being emailed to
 *   somebody who has never heard of this tool. A note in a separate report
 *   does not.
 */

import type { RichDocument, RichRun } from "../document/model.js";
import { richFromText } from "../document/model.js";

import type { CommentedParagraph, DocumentComment } from "./comments.js";
import {
  anchoredComments,
  COMMENT_AUTHOR,
  COMMENT_INITIALS,
  layoutComments,
} from "./comments.js";
import { writeZip } from "./zip.js";

/** Escape text for XML content. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Strip characters XML 1.0 cannot represent at all.
 *
 * Control characters below space — other than tab, newline and carriage
 * return — are not merely awkward to escape, they are forbidden. OCR output
 * occasionally contains one, and a single stray byte makes Word refuse to
 * open the file with an unhelpful "unreadable content" dialog.
 */
function stripInvalidXml(value: string): string {
  // A codepoint test rather than a character class: the class spelling of this
  // is a row of escapes that has to be read one at a time to see what it
  // covers. The rule is one line — below space, keep only tab, newline and
  // carriage return.
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) out += ch;
  }
  return out;
}

/** Either form of a document, as one. */
export type Writable = string | RichDocument;

/**
 * Normalise, and strip what XML cannot hold — before any offset is used.
 *
 * Doing it afterwards would shift every comment marker by however many bytes
 * OCR happened to leave behind.
 */
export function asDocument(source: Writable): RichDocument {
  if (typeof source === "string") {
    return richFromText(stripInvalidXml(source).replace(/\r\n?/g, "\n"));
  }
  return {
    paragraphs: source.paragraphs.map((paragraph) => ({
      runs: paragraph.runs.map((run) => ({ ...run, text: stripInvalidXml(run.text) })),
    })),
  };
}

// ------------------------------------------------------------------ docx ---

const DOCX_CONTENT_TYPES = (
  withComments: boolean,
) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${
    withComments
      ? `\n  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`
      : ""
  }
</Types>`;

const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/**
 * The document's own relationships, which exist only when there are comments.
 *
 * Word will not show a comment part that nothing points at, and an OOXML
 * package with an orphaned part is invalid rather than merely ignored.
 */
const DOCX_DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>`;

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Run properties, in the order the OOXML schema requires them. */
function runProperties(run: RichRun): string {
  const marks =
    (run.bold ? "<w:b/>" : "") +
    (run.italic ? "<w:i/>" : "") +
    (run.underline ? '<w:u w:val="single"/>' : "");
  return marks ? `<w:rPr>${marks}</w:rPr>` : "";
}

/** `xml:space="preserve"` or Word eats leading and trailing spaces. */
function docxRun(run: RichRun): string {
  if (!run.text) return "";
  return `<w:r>${runProperties(run)}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function docxParagraph(paragraph: CommentedParagraph): string {
  const inner = paragraph.chunks
    .map((chunk) => {
      if (chunk.kind === "run") return docxRun(chunk.run);
      if (chunk.kind === "start") return `<w:commentRangeStart w:id="${chunk.id}"/>`;
      // The reference run is what Word draws the bubble from; the range
      // markers alone highlight nothing.
      return (
        `<w:commentRangeEnd w:id="${chunk.id}"/>` +
        `<w:r><w:commentReference w:id="${chunk.id}"/></w:r>`
      );
    })
    .join("");

  return inner ? `<w:p>${inner}</w:p>` : "<w:p/>";
}

export function docxDocumentXml(
  source: Writable,
  comments: readonly DocumentComment[] = [],
): string {
  const body = layoutComments(asDocument(source), comments).map(docxParagraph).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}>
  <w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>
</w:document>`;
}

/**
 * The comment bodies.
 *
 * No `w:date`, deliberately: the ZIP writer already fixes its timestamps so
 * that saving the same document twice produces the same bytes, and a clock
 * reading in here would undo that for no benefit — the comment says where it
 * came from, which is the part a reader needs.
 */
export function docxCommentsXml(comments: readonly DocumentComment[]): string {
  const body = anchoredComments(comments)
    .map((comment, id) => {
      const lines = stripInvalidXml(comment.text)
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => (line ? `<w:p>${docxRun({ text: line })}</w:p>` : "<w:p/>"))
        .join("");
      return (
        `<w:comment w:id="${id}" w:author="${escapeXml(comment.author ?? COMMENT_AUTHOR)}" ` +
        `w:initials="${escapeXml(comment.initials ?? COMMENT_INITIALS)}">${lines}</w:comment>`
      );
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${W_NS}>${body}</w:comments>`;
}

export function writeDocx(
  source: Writable,
  comments: readonly DocumentComment[] = [],
): Promise<Blob> {
  const anchored = anchoredComments(comments);
  return writeZip([
    { name: "[Content_Types].xml", data: DOCX_CONTENT_TYPES(anchored.length > 0) },
    { name: "_rels/.rels", data: DOCX_RELS },
    ...(anchored.length > 0
      ? [
          { name: "word/_rels/document.xml.rels", data: DOCX_DOCUMENT_RELS },
          { name: "word/comments.xml", data: docxCommentsXml(anchored) },
        ]
      : []),
    { name: "word/document.xml", data: docxDocumentXml(source, anchored) },
  ]);
}

// ------------------------------------------------------------------- odt ---

const ODT_MIMETYPE = "application/vnd.oasis.opendocument.text";

const ODT_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIMETYPE}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

/**
 * ODF has no inline formatting attributes: a run points at a named style, and
 * the style is declared in `<office:automatic-styles>`. There are eight
 * combinations of three marks, so they are all declared once and named for
 * what they are rather than generated on demand.
 */
const ODT_STYLE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["b", 'fo:font-weight="bold" style:font-weight-asian="bold"'],
  ["i", 'fo:font-style="italic" style:font-style-asian="italic"'],
  ["u", 'style:text-underline-style="solid" style:text-underline-width="auto"'],
];

function odtStyleName(run: RichRun): string | undefined {
  const parts = [run.bold ? "b" : "", run.italic ? "i" : "", run.underline ? "u" : ""];
  const name = parts.join("");
  return name ? `T_${name}` : undefined;
}

/** Every style a run could ask for, declared up front. */
function odtAutomaticStyles(): string {
  const styles: string[] = [];
  for (let bits = 1; bits < 8; bits++) {
    const marks = ODT_STYLE_NAMES.filter((_, index) => (bits >> index) & 1);
    styles.push(
      `<style:style style:name="T_${marks.map(([key]) => key).join("")}" style:family="text">` +
        `<style:text-properties ${marks.map(([, css]) => css).join(" ")}/>` +
        `</style:style>`,
    );
  }
  return `<office:automatic-styles>${styles.join("")}</office:automatic-styles>`;
}

function odtRun(run: RichRun): string {
  if (!run.text) return "";
  const style = odtStyleName(run);
  const text = escapeXml(run.text);
  return style ? `<text:span text:style-name="${style}">${text}</text:span>` : text;
}

/**
 * ODF puts the comment body inline, where the range opens, and closes it with
 * a matching `<office:annotation-end>`. The two are paired by `office:name`
 * rather than by nesting, which is what lets a comment span paragraphs.
 */
function odtAnnotation(comment: DocumentComment, id: number): string {
  const lines = stripInvalidXml(comment.text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `<text:p>${escapeXml(line)}</text:p>`)
    .join("");

  return (
    `<office:annotation office:name="recite-${id}">` +
    `<dc:creator>${escapeXml(comment.author ?? COMMENT_AUTHOR)}</dc:creator>` +
    `${lines}</office:annotation>`
  );
}

export function odtContentXml(
  source: Writable,
  comments: readonly DocumentComment[] = [],
): string {
  const anchored = anchoredComments(comments);

  const body = layoutComments(asDocument(source), anchored)
    .map(
      (paragraph) =>
        `<text:p>${paragraph.chunks
          .map((chunk) => {
            if (chunk.kind === "run") return odtRun(chunk.run);
            if (chunk.kind === "start") {
              return odtAnnotation(anchored[chunk.id]!, chunk.id);
            }
            return `<office:annotation-end office:name="recite-${chunk.id}"/>`;
          })
          .join("")}</text:p>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  office:version="1.2">
  ${odtAutomaticStyles()}
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`;
}

export function writeOdt(
  source: Writable,
  comments: readonly DocumentComment[] = [],
): Promise<Blob> {
  return writeZip([
    // First and uncompressed, as ODF requires. A reader that checks will
    // reject the file otherwise, even though every ZIP tool opens it.
    { name: "mimetype", data: ODT_MIMETYPE, store: true },
    { name: "META-INF/manifest.xml", data: ODT_MANIFEST },
    { name: "content.xml", data: odtContentXml(source, comments) },
  ]);
}
