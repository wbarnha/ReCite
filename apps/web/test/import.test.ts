/**
 * File import.
 *
 * These run against bytes built here rather than fixtures on disk, so a
 * failure points at the parser instead of at a file someone has to open in
 * Word to inspect. The DOCX and ODT cases build real ZIP archives, deflate
 * included, because reading the archive is most of the work.
 *
 * What every case is really checking: the citations survive. A reader that
 * loses a section sign, joins two paragraphs, or splices a font name into the
 * text does not fail loudly — it produces a document that checks clean.
 */

import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { readHtml, looksLikeHtml } from "../src/import/html.js";
import { readDocx, readOdt } from "../src/import/office.js";
import { looksLikeRtf, readRtf } from "../src/import/rtf.js";
import { decodeEntities, scan } from "../src/import/xml.js";
import { looksLikeZip, readZipText, ZipError } from "../src/import/zip.js";

// --------------------------------------------------------------- helpers ---

/** Build a real ZIP archive with deflated entries. */
function makeZip(files: Record<string, string>): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, contents] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(contents);
    const deflated = deflateRawSync(Buffer.from(raw));

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt32LE(0, 14); // crc, unchecked by the reader
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    Buffer.from(nameBytes).copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    Buffer.from(nameBytes).copy(central, 46);

    locals.push(local, deflated);
    centrals.push(central);
    offset += local.length + deflated.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);

  const all = Buffer.concat([...locals, centralBytes, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const docx = (body: string) =>
  makeZip({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`,
  });

// ------------------------------------------------------------------ XML ---

describe("the tag scanner", () => {
  it("reads text between tags", () => {
    const text = [...scan("<a>hello</a>")]
      .filter((n) => n.kind === "text")
      .map((n) => (n.kind === "text" ? n.text : ""))
      .join("");
    expect(text).toBe("hello");
  });

  it("survives a '>' inside an attribute value", () => {
    // The reason this is a scanner and not a regular expression. Office
    // formats emit attributes like this routinely.
    const nodes = [...scan(`<w:t foo="a>b">text</w:t>`)];
    const names = nodes.filter((n) => n.kind !== "text").map((n) => n.name);
    expect(names).toEqual(["t", "t"]);
    expect(nodes.find((n) => n.kind === "text")).toMatchObject({ text: "text" });
  });

  it("strips namespace prefixes but keeps the qualified name", () => {
    const [tag] = [...scan("<w:tab/>")];
    expect(tag).toMatchObject({
      name: "tab",
      qualifiedName: "w:tab",
      kind: "self-closing",
    });
  });

  it("skips comments, declarations and processing instructions", () => {
    const text = [...scan(`<?xml version="1.0"?><!-- note --><!DOCTYPE x><a>keep</a>`)]
      .filter((n) => n.kind === "text")
      .map((n) => (n.kind === "text" ? n.text : ""))
      .join("");
    expect(text.trim()).toBe("keep");
  });

  it("emits CDATA literally", () => {
    const text = [...scan("<a><![CDATA[5 < 6 & 7 > 2]]></a>")]
      .filter((n) => n.kind === "text")
      .map((n) => (n.kind === "text" ? n.text : ""))
      .join("");
    expect(text).toBe("5 < 6 & 7 > 2");
  });

  it("does not lose the tail on an unterminated tag", () => {
    const text = [...scan("<a>kept</a><broken")]
      .filter((n) => n.kind === "text")
      .map((n) => (n.kind === "text" ? n.text : ""))
      .join("");
    expect(text).toContain("kept");
  });
});

describe("decodeEntities", () => {
  it.each([
    ["&amp;", "&"],
    ["&lt;&gt;", "<>"],
    ["&quot;&apos;", "\"'"],
    ["&#167;", "§"],
    ["&#xa7;", "§"],
    ["&#x2014;", "—"],
  ])("%s becomes %s", (input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });

  it("leaves an unknown entity alone rather than dropping it", () => {
    expect(decodeEntities("&nope;")).toBe("&nope;");
  });
});

// ------------------------------------------------------------------ ZIP ---

describe("the ZIP reader", () => {
  it("inflates an entry", async () => {
    const zip = makeZip({ "a.txt": "hello world" });
    expect(await readZipText(zip, "a.txt")).toBe("hello world");
  });

  it("finds the right entry among several", async () => {
    const zip = makeZip({ "a.txt": "first", "b.txt": "second", "c.txt": "third" });
    expect(await readZipText(zip, "b.txt")).toBe("second");
  });

  it("handles content large enough to actually compress", async () => {
    const body =
      "Miller v. United Airlines, Inc., 174 F.3d 366 (2d Cir. 1999). ".repeat(500);
    const zip = makeZip({ "big.txt": body });
    expect(await readZipText(zip, "big.txt")).toBe(body);
  });

  it("returns undefined for a missing entry", async () => {
    expect(await readZipText(makeZip({ "a.txt": "x" }), "nope.txt")).toBeUndefined();
  });

  it("rejects something that is not a ZIP", async () => {
    const notZip = new TextEncoder().encode("plain text, not an archive at all");
    await expect(readZipText(notZip.buffer, "a")).rejects.toThrow(ZipError);
  });

  it("recognises the local header signature", () => {
    expect(looksLikeZip(makeZip({ "a.txt": "x" }))).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode("nope").buffer)).toBe(false);
  });
});

// ----------------------------------------------------------------- DOCX ---

describe("reading .docx", () => {
  it("extracts the text of a paragraph", async () => {
    const text = await readDocx(docx("<w:p><w:r><w:t>Hello</w:t></w:r></w:p>"));
    expect(text).toBe("Hello");
  });

  it("keeps paragraphs apart", async () => {
    // Load-bearing: `Id.` refers to the citation before it, so joining
    // paragraphs changes which citations look adjacent.
    const text = await readDocx(
      docx(
        "<w:p><w:r><w:t>Iqbal, 556 U.S. 662 (2009).</w:t></w:r></w:p>" +
          "<w:p><w:r><w:t>Id. at 678.</w:t></w:r></w:p>",
      ),
    );
    expect(text.split("\n").filter(Boolean)).toEqual([
      "Iqbal, 556 U.S. 662 (2009).",
      "Id. at 678.",
    ]);
  });

  it("joins runs inside one paragraph without a space", async () => {
    // Word splits a citation across runs whenever formatting changes mid-word,
    // which happens constantly with italicised case names.
    const text = await readDocx(
      docx("<w:p><w:r><w:t>174 F.</w:t></w:r><w:r><w:t>3d 366</w:t></w:r></w:p>"),
    );
    expect(text).toBe("174 F.3d 366");
  });

  it("reads tabs and line breaks", async () => {
    const text = await readDocx(
      docx("<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>"),
    );
    expect(text).toBe("a\tb\nc");
  });

  it("ignores formatting elements", async () => {
    const text = await readDocx(
      docx(
        '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Miller</w:t></w:r></w:p>',
      ),
    );
    expect(text).toBe("Miller");
  });

  it("preserves a section sign", async () => {
    // `11 U.S.C. § 362` is a citation; losing the sign changes it.
    const text = await readDocx(
      docx("<w:p><w:r><w:t>11 U.S.C. &#167; 362</w:t></w:r></w:p>"),
    );
    expect(text).toBe("11 U.S.C. § 362");
  });

  it("collapses the empty paragraphs Word emits for blank lines", async () => {
    const text = await readDocx(
      docx(
        "<w:p><w:r><w:t>One</w:t></w:r></w:p><w:p/><w:p/><w:p/><w:p><w:r><w:t>Two</w:t></w:r></w:p>",
      ),
    );
    expect(text).toBe("One\n\nTwo");
  });

  it("explains itself when the archive is not a .docx", async () => {
    await expect(readDocx(makeZip({ "random.txt": "x" }))).rejects.toThrow(
      /does not look like a \.docx/,
    );
  });
});

describe("reading .odt", () => {
  const odt = (body: string) =>
    makeZip({
      mimetype: "application/vnd.oasis.opendocument.text",
      "content.xml": `<?xml version="1.0"?><office:document-content xmlns:office="x" xmlns:text="y"><office:body><office:text>${body}</office:text></office:body></office:document-content>`,
    });

  it("extracts text that is direct content of a paragraph", async () => {
    // ODF has no `<w:t>` wrapper. A reader written for OOXML captures nothing
    // here and silently returns an empty document.
    const text = await readOdt(odt("<text:p>Iqbal, 556 U.S. 662 (2009).</text:p>"));
    expect(text).toBe("Iqbal, 556 U.S. 662 (2009).");
  });

  it("keeps paragraphs and headings apart", async () => {
    const text = await readOdt(
      odt("<text:h>Argument</text:h><text:p>Id. at 678.</text:p>"),
    );
    expect(text.split("\n").filter(Boolean)).toEqual(["Argument", "Id. at 678."]);
  });

  it("reads text inside a span", async () => {
    const text = await readOdt(
      odt("<text:p>174 <text:span>F.3d</text:span> 366</text:p>"),
    );
    expect(text).toBe("174 F.3d 366");
  });

  it("reads encoded spaces and tabs", async () => {
    const text = await readOdt(odt("<text:p>a<text:s/>b<text:tab/>c</text:p>"));
    expect(text).toBe("a b\tc");
  });

  it("drops tracked changes and annotations", async () => {
    const text = await readOdt(
      odt(
        "<text:p>Kept<office:annotation><text:p>A comment</text:p></office:annotation></text:p>",
      ),
    );
    expect(text).toBe("Kept");
  });

  it("explains itself when the archive is not an .odt", async () => {
    await expect(readOdt(makeZip({ "random.txt": "x" }))).rejects.toThrow(
      /does not look like an? \.odt/,
    );
  });
});

// ------------------------------------------------------------------ RTF ---

describe("reading .rtf", () => {
  // The trailing space after `\\deff0` is the control-word delimiter and is
  // required: without it `\\deff0` followed by `11 U.S.C.` parses as the control
  // word `\\deff` with parameter 011, swallowing the volume number.
  const wrap = (body: string) => `{\\rtf1\\ansi\\deff0 ${body}}`;

  it("reads plain text", () => {
    expect(readRtf(wrap("Hello world"))).toBe("Hello world");
  });

  it("turns \\par into a line break", () => {
    expect(readRtf(wrap("First\\par Second"))).toBe("First\nSecond");
  });

  it("drops the font table rather than splicing it into the document", () => {
    // Without this the brief begins "Times New Roman".
    const text = readRtf(
      wrap("{\\fonttbl{\\f0\\froman Times New Roman;}}Miller v. United Airlines"),
    );
    expect(text).toBe("Miller v. United Airlines");
  });

  it("drops other metadata destinations", () => {
    const text = readRtf(
      wrap(
        "{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Riched20 10.0;}{\\info{\\author Someone}}Body text",
      ),
    );
    expect(text).toBe("Body text");
  });

  it("decodes a hex escape to the right character", () => {
    // `\'a7` is a section sign. Dropping it changes `§ 362` into ` 362`.
    expect(readRtf(wrap("11 U.S.C. \\'a7 362"))).toBe("11 U.S.C. § 362");
  });

  it("decodes Windows-1252 punctuation, not Latin-1", () => {
    // 0x96 is an en dash in CP1252 and unassigned in Latin-1; 0x97 is the em
    // dash. A page range written with either has to survive.
    expect(readRtf(wrap("371\\'96 72"))).toBe("371– 72");
    expect(readRtf(wrap("371\\'97 72"))).toBe("371— 72");
    expect(readRtf(wrap("\\'93quoted\\'94"))).toBe("“quoted”");
  });

  it("reads a Unicode escape and skips its fallback", () => {
    // `舒` is an em dash followed by a `?` for readers that cannot show
    // it. Keeping the `?` would corrupt every page range.
    expect(readRtf(wrap("371\\u8212?72"))).toBe("371—72");
  });

  it("honours \\uc for multi-character fallbacks", () => {
    expect(readRtf(wrap("\\uc2 371\\u8212??72"))).toBe("371—72");
  });

  it("reads escaped braces and backslashes", () => {
    expect(readRtf(wrap("a\\{b\\}c\\\\d"))).toBe("a{b}c\\d");
  });

  it("reads control words for dashes", () => {
    expect(readRtf(wrap("371\\endash 72"))).toBe("371–72");
  });

  it("keeps a whole citation intact", () => {
    const text = readRtf(
      wrap(
        "{\\fonttbl{\\f0 Times;}}Miller v. United Airlines, Inc., 174 F.3d 366, 371\\u8212?72 (2d Cir. 1999).",
      ),
    );
    expect(text).toBe(
      "Miller v. United Airlines, Inc., 174 F.3d 366, 371—72 (2d Cir. 1999).",
    );
  });

  it("recognises the format", () => {
    expect(looksLikeRtf("{\\rtf1\\ansi}")).toBe(true);
    expect(looksLikeRtf("  {\\rtf1")).toBe(true);
    expect(looksLikeRtf("not rtf")).toBe(false);
  });
});

// ----------------------------------------------------------------- HTML ---

describe("reading .html", () => {
  it("extracts paragraph text", () => {
    expect(readHtml("<html><body><p>Hello</p><p>World</p></body></html>")).toBe(
      "Hello\nWorld",
    );
  });

  it("drops script and style content", () => {
    const text = readHtml(
      "<html><head><style>p{color:red}</style></head><body><script>alert(1)</script><p>Keep</p></body></html>",
    );
    expect(text).toBe("Keep");
  });

  it("does not re-enable text when a nested element inside head closes", () => {
    // A counter rather than a flag: `</style>` must not turn `<head>` back on.
    const text = readHtml(
      "<html><head><title>T</title><style>x</style></head><body><p>Body</p></body></html>",
    );
    expect(text).toBe("Body");
  });

  it("collapses source indentation", () => {
    const text = readHtml("<body>\n  <p>\n    Miller v. Jones\n  </p>\n</body>");
    expect(text).toBe("Miller v. Jones");
  });

  it("decodes entities in the text", () => {
    expect(readHtml("<p>11 U.S.C. &#167; 362</p>")).toBe("11 U.S.C. § 362");
  });

  it("recognises the format", () => {
    expect(looksLikeHtml("<!DOCTYPE html><html>")).toBe(true);
    expect(looksLikeHtml("<html lang=en>")).toBe(true);
    expect(looksLikeHtml("plain text")).toBe(false);
  });
});
