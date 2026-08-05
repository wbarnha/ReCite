/**
 * Saving a document back out.
 *
 * The round trip is what these check: text written as `.docx` and read back by
 * ReCite's own importer must be the same text. A writer that loses a section
 * sign or joins two paragraphs produces a file that opens fine and is subtly
 * wrong, which is the failure mode worth testing for.
 */

import { describe, expect, it } from "vitest";

import {
  baseName,
  buildExport,
  EXPORT_FORMATS,
  isReport,
  type ReportContext,
} from "../src/export/index.js";
import {
  docxDocumentXml,
  odtContentXml,
  writeDocx,
  writeOdt,
} from "../src/export/office.js";
import { toWinAnsi, wrap, writePdf } from "../src/export/pdf.js";
import { crc32, writeZip } from "../src/export/zip.js";
import { readDocx, readOdt } from "../src/import/office.js";
import { readRtf } from "../src/import/rtf.js";
import { readHtml } from "../src/import/html.js";
import { looksLikeZip } from "../src/import/zip.js";

const SAMPLE = [
  "Miller v. United Airlines, Inc., 174 F.3d 366, 371–72 (2d Cir. 1999).",
  "",
  "See 11 U.S.C. § 362(a)(1); Iqbal, 556 U.S. 662, 678 (2009).",
  "Id. at 680 (“quoted material”).",
].join("\n");

const CONTEXT: ReportContext = {
  documentName: "brief.docx",
  profile: "Bluebook 21st edition, court documents",
  citationCount: 4,
  findings: [
    {
      ruleId: "RP001",
      ruleName: "reporter-format",
      severity: "warning",
      message: 'Reporter "F.3d" is spaced differently here, with a comma, in it',
      citation: "174 F.3d 366",
      start: 32,
      end: 44,
      suggestion: "174 F.3d 366",
    },
  ],
  version: "1.0.0.0",
  commit: "abc123def456",
};

const blobText = (blob: Blob) => blob.text();
const blobBuffer = async (blob: Blob) => blob.arrayBuffer();

describe("CRC-32", () => {
  it.each([
    ["", 0],
    ["a", 0xe8b7be43],
    ["abc", 0x352441c2],
    ["123456789", 0xcbf43926],
  ])("of %o is correct", (input, expected) => {
    // Known vectors. Word rejects an archive whose CRCs are wrong, and a
    // wrong table produces a file that every ZIP tool opens and Word refuses.
    expect(crc32(new TextEncoder().encode(input))).toBe(expected);
  });
});

describe("the ZIP writer", () => {
  it("produces something the reader recognises", async () => {
    const zip = await writeZip([{ name: "a.txt", data: "hello" }]);
    expect(looksLikeZip(await blobBuffer(zip))).toBe(true);
  });

  it("round-trips through our own reader", async () => {
    const { readZipText } = await import("../src/import/zip.js");
    const zip = await writeZip([
      { name: "one.txt", data: "first" },
      { name: "two.txt", data: "second" },
    ]);
    const buffer = await blobBuffer(zip);
    expect(await readZipText(buffer, "one.txt")).toBe("first");
    expect(await readZipText(buffer, "two.txt")).toBe("second");
  });

  it("stores an entry uncompressed when asked", async () => {
    // ODF requires it for `mimetype`; a deflated one is not a valid .odt even
    // though every ZIP tool opens it.
    const zip = await writeZip([
      { name: "mimetype", data: "application/x", store: true },
    ]);
    const bytes = new Uint8Array(await blobBuffer(zip));
    expect(new DataView(bytes.buffer).getUint16(8, true)).toBe(0);
  });

  it("handles content large enough to actually compress", async () => {
    const { readZipText } = await import("../src/import/zip.js");
    const body = `${SAMPLE}\n`.repeat(400);
    const zip = await writeZip([{ name: "big.txt", data: body }]);
    expect(await readZipText(await blobBuffer(zip), "big.txt")).toBe(body);
  });
});

describe("writing .docx", () => {
  it("round-trips through the importer", async () => {
    const docx = await writeDocx(SAMPLE);
    expect(await readDocx(await blobBuffer(docx))).toBe(SAMPLE);
  });

  it("keeps the characters citations are made of", async () => {
    const docx = await writeDocx("11 U.S.C. § 362 — 371–72 “quoted”");
    expect(await readDocx(await blobBuffer(docx))).toBe(
      "11 U.S.C. § 362 — 371–72 “quoted”",
    );
  });

  it("preserves a leading space rather than letting Word eat it", () => {
    expect(docxDocumentXml("  indented")).toContain('xml:space="preserve"');
  });

  it("writes an empty paragraph for a blank line", () => {
    expect(docxDocumentXml("a\n\nb")).toContain("<w:p/>");
  });

  it("escapes XML rather than producing a broken document", () => {
    const xml = docxDocumentXml("5 < 6 & 7 > 2");
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&amp;");
    expect(xml).not.toMatch(/<w:t[^>]*>5 < 6/);
  });

  it("strips control characters XML cannot hold", async () => {
    // OCR output occasionally contains one, and a single stray byte makes
    // Word refuse the file with an unhelpful "unreadable content" dialog.
    const docx = await writeDocx("beforeafter");
    expect(await readDocx(await blobBuffer(docx))).toBe("beforeafter");
  });
});

describe("writing .odt", () => {
  it("round-trips through the importer", async () => {
    const odt = await writeOdt(SAMPLE);
    expect(await readOdt(await blobBuffer(odt))).toBe(SAMPLE);
  });

  it("puts an uncompressed mimetype first, as ODF requires", async () => {
    const bytes = new Uint8Array(await blobBuffer(await writeOdt("x")));
    const name = new TextDecoder().decode(bytes.subarray(30, 38));
    expect(name).toBe("mimetype");
    expect(new DataView(bytes.buffer).getUint16(8, true)).toBe(0);
  });

  it("declares the right media type", () => {
    expect(odtContentXml("x")).toContain("office:document-content");
  });
});

describe("writing .rtf", () => {
  const rtfOf = async (text: string) =>
    blobText(
      await buildExport(
        EXPORT_FORMATS.find((f) => f.id === "rtf")!,
        text,
        CONTEXT,
      ),
    );

  it("round-trips through the importer", async () => {
    expect(readRtf(await rtfOf(SAMPLE))).toBe(SAMPLE);
  });

  it("escapes non-ASCII rather than writing mojibake", async () => {
    const rtf = await rtfOf("§ 362 — 371–72");
    expect(rtf).toContain("\\u167?");
    expect(readRtf(rtf)).toBe("§ 362 — 371–72");
  });

  it("escapes braces and backslashes", async () => {
    expect(readRtf(await rtfOf("a{b}c\\d"))).toBe("a{b}c\\d");
  });
});

describe("writing HTML", () => {
  it("round-trips through the importer", async () => {
    const html = await blobText(
      await buildExport(
        EXPORT_FORMATS.find((f) => f.id === "html")!,
        SAMPLE,
        CONTEXT,
      ),
    );
    // The blank line survives: it is written as `<p>&nbsp;</p>` and read back
    // as an empty line, rather than being collapsed away.
    expect(readHtml(html)).toBe(SAMPLE);
  });

  it("escapes rather than injecting markup", async () => {
    const html = await blobText(
      await buildExport(
        EXPORT_FORMATS.find((f) => f.id === "html")!,
        "<script>alert(1)</script>",
        CONTEXT,
      ),
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("writing PDF", () => {
  it("produces a file a reader will accept", async () => {
    const bytes = new Uint8Array(await blobBuffer(writePdf(SAMPLE)));
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 9));
    expect(head).toBe("%PDF-1.4\n");
    const tail = new TextDecoder("latin1").decode(bytes.subarray(-6));
    expect(tail.trim()).toBe("%%EOF");
  });

  it("records cross-reference offsets that actually point at objects", async () => {
    // The offsets are string indices, so writing the file as UTF-8 would
    // shift every one of them and produce a PDF readers reject.
    const text = new TextDecoder("latin1").decode(
      new Uint8Array(await blobBuffer(writePdf(SAMPLE))),
    );
    const startxref = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");

    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets.length).toBeGreaterThan(3);
    for (const [index, offset] of offsets.entries()) {
      expect(text.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    }
  });

  it("keeps a page range readable when the dash cannot be encoded", () => {
    // Dropping the dash would turn 371–72 into 37172, which is a different
    // citation rather than a formatting problem.
    expect(toWinAnsi("371–72")).toBe("371-72");
    expect(toWinAnsi("371—72")).toBe("371--72");
    expect(toWinAnsi("§ 362")).toBe("§ 362");
  });

  it("replaces genuinely unrepresentable characters rather than dropping them", () => {
    expect(toWinAnsi("金 362")).toBe("? 362");
  });

  it("wraps on measured width, not character count", () => {
    // Same character count, very different width. Measuring in characters
    // would give these the same number of lines and overflow the margin on
    // the wide one.
    const narrow = wrap(Array.from({ length: 60 }, () => "Ill").join(" "));
    const wide = wrap(Array.from({ length: 60 }, () => "WWW").join(" "));
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("does not lose a word too long to fit on any line", () => {
    // It cannot be broken, so it goes on a line of its own rather than
    // vanishing.
    const lines = wrap("W".repeat(200));
    expect(lines.join("")).toBe("W".repeat(200));
  });

  it("never returns an empty page", async () => {
    const bytes = new Uint8Array(await blobBuffer(writePdf("")));
    expect(bytes.length).toBeGreaterThan(200);
  });

  it("paginates a long document", async () => {
    const long = `${SAMPLE}\n`.repeat(50);
    const text = new TextDecoder("latin1").decode(
      new Uint8Array(await blobBuffer(writePdf(long))),
    );
    const pages = Number(/\/Count (\d+)/.exec(text)?.[1]);
    expect(pages).toBeGreaterThan(1);
  });

  it("escapes the characters that would break a PDF string", async () => {
    const text = new TextDecoder("latin1").decode(
      new Uint8Array(await blobBuffer(writePdf("a (b) c \\ d"))),
    );
    expect(text).toContain("\\(b\\)");
    expect(text).toContain("\\\\");
  });
});

describe("findings reports", () => {
  const build = async (id: string) =>
    blobText(
      await buildExport(
        EXPORT_FORMATS.find((f) => f.id === id)!,
        SAMPLE,
        CONTEXT,
      ),
    );

  it("writes JSON that parses", async () => {
    const parsed: unknown = JSON.parse(await build("report.json"));
    expect(parsed).toMatchObject({
      tool: "ReCite",
      citations: 4,
      commit: "abc123def456",
    });
  });

  it("quotes CSV fields containing commas and quotes", async () => {
    // The message in the fixture contains both, on purpose.
    const csv = await build("report.csv");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("rule,name,severity,citation,start,end,message,suggestion");
    expect(lines[1]).toContain('"');
    expect(lines).toHaveLength(2);
  });

  it("writes Markdown with one row per finding", async () => {
    const md = await build("report.md");
    expect(md).toContain("| `RP001` |");
    expect(md).toContain("Citations found:** 4");
  });

  it("says plainly that no findings is not a verification", async () => {
    const md = await blobText(
      await buildExport(
        EXPORT_FORMATS.find((f) => f.id === "report.md")!,
        SAMPLE,
        {
          ...CONTEXT,
          findings: [],
        },
      ),
    );
    expect(md).toMatch(/not a verification/i);
  });
});

describe("filenames", () => {
  it.each([
    ["brief.docx", "brief"],
    ["brief", "brief"],
    ["a/b\\c:d.txt", "a-b-c-d"],
    ["", "document"],
    [".txt", "document"],
  ])("%o becomes %o", (input, expected) => {
    expect(baseName(input)).toBe(expected);
  });
});

describe("the format list", () => {
  it("offers every format the importer can read", () => {
    const ids = new Set(EXPORT_FORMATS.map((format) => format.id));
    for (const id of ["txt", "md", "docx", "odt", "rtf", "html", "pdf"]) {
      expect(ids).toContain(id);
    }
  });

  it("has a unique id and a note for each", () => {
    expect(new Set(EXPORT_FORMATS.map((f) => f.id)).size).toBe(EXPORT_FORMATS.length);
    for (const format of EXPORT_FORMATS) {
      expect(format.note.length).toBeGreaterThan(10);
      expect(format.extension.startsWith(".")).toBe(true);
    }
  });

  it("distinguishes reports from documents", () => {
    expect(EXPORT_FORMATS.filter(isReport).map((f) => f.id)).toEqual([
      "report.json",
      "report.csv",
      "report.md",
    ]);
  });
});
