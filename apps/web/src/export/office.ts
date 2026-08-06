/**
 * Writing `.docx` and `.odt`.
 *
 * Both are the minimum a conforming reader needs and no more. ReCite works on
 * the text of citations and never had the styling, so writing a document that
 * pretended to would be inventing formatting the user did not ask for. What
 * comes out is the corrected text, one paragraph per line, in a document Word
 * and LibreOffice open without complaint.
 *
 * With one addition: **comments**. When ReCite has pulled the passage a pin
 * cite points at, that note is written into the file as a real comment —
 * `word/comments.xml` for OOXML, `<office:annotation>` for ODF — so it lands
 * in the margin next to the citation and survives being emailed to somebody
 * who has never heard of this tool. A note in a separate report does not.
 */

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

function paragraphs(text: string): string[] {
  return stripInvalidXml(text).replace(/\r\n?/g, "\n").split("\n");
}

/**
 * The paragraphs, with comment markers in place.
 *
 * Control characters are stripped *before* the offsets are used, so a comment
 * anchored at character 400 still lands on character 400 — doing it afterwards
 * would shift every marker by however many bytes OCR happened to leave behind.
 */
function commentedParagraphs(
  text: string,
  comments: readonly DocumentComment[],
): CommentedParagraph[] {
  return layoutComments(stripInvalidXml(text).replace(/\r\n?/g, "\n"), comments);
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

/** `xml:space="preserve"` or Word eats leading and trailing spaces. */
function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

export function docxDocumentXml(
  text: string,
  comments: readonly DocumentComment[] = [],
): string {
  const body =
    comments.length === 0
      ? paragraphs(text)
          .map((line) => (line ? `<w:p>${run(line)}</w:p>` : "<w:p/>"))
          .join("")
      : commentedParagraphs(text, comments)
          .map((paragraph) => {
            const inner = paragraph.chunks
              .map((chunk) => {
                if (chunk.kind === "text") return chunk.text ? run(chunk.text) : "";
                if (chunk.kind === "start") {
                  return `<w:commentRangeStart w:id="${chunk.id}"/>`;
                }
                // The reference run is what Word draws the bubble from; the
                // range markers alone highlight nothing.
                return (
                  `<w:commentRangeEnd w:id="${chunk.id}"/>` +
                  `<w:r><w:commentReference w:id="${chunk.id}"/></w:r>`
                );
              })
              .join("");
            return inner ? `<w:p>${inner}</w:p>` : "<w:p/>";
          })
          .join("");

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
        .map((line) => (line ? `<w:p>${run(line)}</w:p>` : "<w:p/>"))
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
  text: string,
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
    { name: "word/document.xml", data: docxDocumentXml(text, anchored) },
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
  text: string,
  comments: readonly DocumentComment[] = [],
): string {
  const anchored = anchoredComments(comments);

  const body =
    anchored.length === 0
      ? paragraphs(text)
          .map((line) => `<text:p>${escapeXml(line)}</text:p>`)
          .join("")
      : commentedParagraphs(text, anchored)
          .map(
            (paragraph) =>
              `<text:p>${paragraph.chunks
                .map((chunk) => {
                  if (chunk.kind === "text") return escapeXml(chunk.text);
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
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  office:version="1.2">
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`;
}

export function writeOdt(
  text: string,
  comments: readonly DocumentComment[] = [],
): Promise<Blob> {
  return writeZip([
    // First and uncompressed, as ODF requires. A reader that checks will
    // reject the file otherwise, even though every ZIP tool opens it.
    { name: "mimetype", data: ODT_MIMETYPE, store: true },
    { name: "META-INF/manifest.xml", data: ODT_MANIFEST },
    { name: "content.xml", data: odtContentXml(text, comments) },
  ]);
}
