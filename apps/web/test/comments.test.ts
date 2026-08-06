/**
 * Notes written into the saved file, as comments.
 *
 * The reason this feature exists is that a report beside a document does not
 * travel with it. A partner who opens the `.docx` should see the passage the
 * pin cite points at, in the margin, next to the citation — without knowing
 * ReCite exists.
 *
 * Two things are worth failing a build over. **The document text must be
 * unchanged**: a comment is not an edit, and a writer that shifted a character
 * while adding one would corrupt exactly the thing being checked. And **the
 * markers must land on the citation**, because a comment attached to the wrong
 * sentence is worse than no comment.
 */

import { describe, expect, it } from "vitest";

import type { DocumentComment } from "../src/export/comments.js";
import { anchoredComments, layoutComments } from "../src/export/comments.js";
import {
  buildExport,
  EXPORT_FORMATS,
  type ReportContext,
} from "../src/export/index.js";
import {
  docxCommentsXml,
  docxDocumentXml,
  odtContentXml,
  writeDocx,
  writeOdt,
} from "../src/export/office.js";
import { readDocx, readOdt } from "../src/import/office.js";
import { readZipText } from "../src/import/zip.js";

const TEXT = [
  "The pleading standard is set out in Iqbal, 556 U.S. 662, 678 (2009).",
  "",
  "See also Twombly, 550 U.S. 544, 570 (2007).",
].join("\n");

const IQBAL = TEXT.indexOf("556 U.S. 662");
const TWOMBLY = TEXT.indexOf("550 U.S. 544");

const COMMENTS: readonly DocumentComment[] = [
  {
    span: { start: IQBAL, end: IQBAL + "556 U.S. 662".length },
    text: "Ashcroft v. Iqbal, at 678\n“Threadbare recitals … do not suffice.”\nCourtListener",
  },
  {
    span: { start: TWOMBLY, end: TWOMBLY + "550 U.S. 544".length },
    text: "Bell Atlantic Corp. v. Twombly, at 570",
  },
];

const CONTEXT: ReportContext = {
  documentName: "brief.docx",
  profile: "Bluebook 21st edition, court documents",
  citationCount: 2,
  findings: [],
  version: "1.0.0.0",
  commit: "abc123def456",
  reporterData: "v3.2.66",
};

const buffer = (blob: Blob) => blob.arrayBuffer();

describe("working out where the markers go", () => {
  it("splits a paragraph around the span the comment covers", () => {
    const paragraphs = layoutComments("abc DEF ghi", [
      { span: { start: 4, end: 7 }, text: "note" },
    ]);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.chunks).toEqual([
      { kind: "text", text: "abc " },
      { kind: "start", id: 0 },
      { kind: "text", text: "DEF" },
      { kind: "end", id: 0 },
      { kind: "text", text: " ghi" },
    ]);
  });

  it("keeps one paragraph per line, so the document shape survives", () => {
    expect(layoutComments("a\n\nb", [])).toHaveLength(3);
  });

  it("opens in one paragraph and closes in another when a span crosses a break", () => {
    const paragraphs = layoutComments("first\nsecond", [
      { span: { start: 2, end: 9 }, text: "note" },
    ]);
    expect(paragraphs[0]!.chunks.map((c) => c.kind)).toEqual(["text", "start", "text"]);
    expect(paragraphs[1]!.chunks.map((c) => c.kind)).toEqual(["text", "end", "text"]);
  });

  it("closes one range before opening the next at the same offset", () => {
    // Otherwise two adjacent comments overlap, and Word draws one bubble
    // covering both citations.
    const paragraphs = layoutComments("abcdef", [
      { span: { start: 0, end: 3 }, text: "one" },
      { span: { start: 3, end: 6 }, text: "two" },
    ]);
    expect(paragraphs[0]!.chunks.map((c) => c.kind)).toEqual([
      "start",
      "text",
      "end",
      "start",
      "text",
      "end",
    ]);
  });

  it("drops an empty range, and numbers the rest from what is left", () => {
    // The id is an index into `anchoredComments`, so a dropped comment must
    // not leave a marker pointing at the wrong body.
    const comments: DocumentComment[] = [
      { span: { start: 2, end: 2 }, text: "nothing to highlight" },
      { span: { start: 0, end: 3 }, text: "the real one" },
    ];
    expect(anchoredComments(comments)).toHaveLength(1);
    const [paragraph] = layoutComments("abcdef", comments);
    expect(paragraph!.chunks).toContainEqual({ kind: "start", id: 0 });
  });
});

describe("comments in a .docx", () => {
  it("does not change a character of the document", async () => {
    const docx = await writeDocx(TEXT, COMMENTS);
    expect(await readDocx(await buffer(docx))).toBe(TEXT);
  });

  it("wraps the citation in a comment range, not the paragraph", () => {
    const xml = docxDocumentXml(TEXT, COMMENTS);
    expect(xml).toMatch(
      /<w:commentRangeStart w:id="0"\/><w:r><w:t[^>]*>556 U\.S\. 662<\/w:t><\/w:r><w:commentRangeEnd w:id="0"\/>/,
    );
  });

  it("writes a reference run, without which Word draws nothing", () => {
    expect(docxDocumentXml(TEXT, COMMENTS)).toContain(
      '<w:r><w:commentReference w:id="0"/></w:r>',
    );
  });

  it("packages the comment part, its content type and its relationship", async () => {
    const bytes = await buffer(await writeDocx(TEXT, COMMENTS));

    const types = await readZipText(bytes, "[Content_Types].xml");
    expect(types).toContain("wordprocessingml.comments+xml");

    const rels = await readZipText(bytes, "word/_rels/document.xml.rels");
    expect(rels).toContain("relationships/comments");
    expect(rels).toContain('Target="comments.xml"');

    const comments = await readZipText(bytes, "word/comments.xml");
    expect(comments).toContain("Threadbare recitals");
    expect(comments).toContain('w:author="ReCite"');
  });

  it("adds nothing to a document with no comments", async () => {
    const bytes = await buffer(await writeDocx(TEXT));
    expect(await readZipText(bytes, "word/comments.xml")).toBeUndefined();
    // An orphaned part makes the package invalid rather than merely unused.
    expect(await readZipText(bytes, "[Content_Types].xml")).not.toContain(
      "comments+xml",
    );
  });

  it("turns each line of a note into a paragraph of the bubble", () => {
    const xml = docxCommentsXml([{ span: { start: 0, end: 1 }, text: "one\ntwo" }]);
    expect(xml.match(/<w:p>/g)).toHaveLength(2);
  });

  it("escapes a note rather than injecting markup into the package", () => {
    const xml = docxCommentsXml([
      { span: { start: 0, end: 1 }, text: "</w:comment><w:evil/>" },
    ]);
    expect(xml).not.toContain("<w:evil/>");
    expect(xml).toContain("&lt;/w:comment&gt;");
  });
});

describe("annotations in an .odt", () => {
  it("does not change a character of the document", async () => {
    // The reader has to suppress the comment body on the way out as well as
    // on the way in: a `<text:p>` inside an annotation used to push a newline
    // into the middle of the paragraph the annotation was attached to.
    const odt = await writeOdt(TEXT, COMMENTS);
    expect(await readOdt(await buffer(odt))).toBe(TEXT);
  });

  it("pairs the annotation with an end marker by name", () => {
    const xml = odtContentXml(TEXT, COMMENTS);
    expect(xml).toContain('<office:annotation office:name="recite-0">');
    expect(xml).toContain('<office:annotation-end office:name="recite-0"/>');
    expect(xml).toContain("<dc:creator>ReCite</dc:creator>");
    expect(xml).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
  });

  it("adds nothing to a document with no comments", () => {
    expect(odtContentXml(TEXT)).not.toContain("office:annotation");
  });
});

describe("formats with nowhere to put a comment", () => {
  it.each(["txt", "md", "rtf", "html", "pdf"])(
    "%s is saved as though there were none",
    async (id) => {
      const format = EXPORT_FORMATS.find((f) => f.id === id)!;
      const withComments = await buildExport(format, TEXT, CONTEXT, COMMENTS);
      const without = await buildExport(format, TEXT, CONTEXT);
      // Identical bytes: the user asked to save their document, not a
      // marked-up copy of it. What each format does with a note is stated
      // next to the format picker rather than guessed at here.
      expect(await withComments.text()).toBe(await without.text());
    },
  );
});

describe("reports carry the quotations as data", () => {
  const context: ReportContext = {
    ...CONTEXT,
    authority: "CourtListener, the Free Law Project's collection",
    annotations: [
      {
        citation: "556 U.S. 662",
        caseName: "Ashcroft v. Iqbal",
        pinCite: "678",
        quotation: "Threadbare recitals … do not suffice.",
        url: "https://www.courtlistener.com/opinion/1/x/#p678",
        source: "CourtListener",
        start: IQBAL,
        end: IQBAL + 12,
      },
    ],
  };

  const build = async (id: string) =>
    (
      await buildExport(
        EXPORT_FORMATS.find((f) => f.id === id)!,
        TEXT,
        context,
      )
    ).text();

  it("records how the citations were verified, so absence means something", async () => {
    const report: unknown = JSON.parse(await build("report.json"));
    expect(report).toMatchObject({
      authority: "CourtListener, the Free Law Project's collection",
    });
  });

  it("puts the quotation in the JSON", async () => {
    const report = JSON.parse(await build("report.json")) as {
      annotations: Array<{ quotation: string }>;
    };
    expect(report.annotations[0]!.quotation).toContain("Threadbare");
  });

  it("gives the CSV a row per quotation, under its own rule id", async () => {
    const csv = await build("report.csv");
    expect(csv).toContain("PIN,pincite-quotation");
    expect(csv).toContain("Threadbare");
  });

  it("gives the Markdown a section, with the caveat attached", async () => {
    const markdown = await build("report.md");
    expect(markdown).toContain("## Pincite quotations");
    expect(markdown).toContain("> Threadbare recitals");
    expect(markdown).toMatch(/not a substitute for reading the/);
  });

  it("says nothing about quotations when there are none", async () => {
    const plain = await (
      await buildExport(
        EXPORT_FORMATS.find((f) => f.id === "report.md")!,
        TEXT,
        CONTEXT,
      )
    ).text();
    expect(plain).not.toContain("Pincite quotations");
  });
});
