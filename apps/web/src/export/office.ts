/**
 * Writing `.docx` and `.odt`.
 *
 * Both are the minimum a conforming reader needs and no more. ReCite works on
 * the text of citations and never had the styling, so writing a document that
 * pretended to would be inventing formatting the user did not ask for. What
 * comes out is the corrected text, one paragraph per line, in a document Word
 * and LibreOffice open without complaint.
 */

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

// ------------------------------------------------------------------ docx ---

const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export function docxDocumentXml(text: string): string {
  const body = paragraphs(text)
    .map((line) =>
      line
        ? // `xml:space="preserve"` or Word eats leading and trailing spaces,
          // which matters when a citation starts a line.
          `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
        : "<w:p/>",
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>
</w:document>`;
}

export function writeDocx(text: string): Promise<Blob> {
  return writeZip([
    { name: "[Content_Types].xml", data: DOCX_CONTENT_TYPES },
    { name: "_rels/.rels", data: DOCX_RELS },
    { name: "word/document.xml", data: docxDocumentXml(text) },
  ]);
}

// ------------------------------------------------------------------- odt ---

const ODT_MIMETYPE = "application/vnd.oasis.opendocument.text";

const ODT_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIMETYPE}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

export function odtContentXml(text: string): string {
  const body = paragraphs(text)
    .map((line) => `<text:p>${escapeXml(line)}</text:p>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  office:version="1.2">
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`;
}

export function writeOdt(text: string): Promise<Blob> {
  return writeZip([
    // First and uncompressed, as ODF requires. A reader that checks will
    // reject the file otherwise, even though every ZIP tool opens it.
    { name: "mimetype", data: ODT_MIMETYPE, store: true },
    { name: "META-INF/manifest.xml", data: ODT_MANIFEST },
    { name: "content.xml", data: odtContentXml(text) },
  ]);
}
