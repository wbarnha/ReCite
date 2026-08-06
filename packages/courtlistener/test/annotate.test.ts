/**
 * Pulling the passage a pin cite points at.
 *
 * The rule these tests exist to hold: **ReCite never guesses at a page.** An
 * opinion CourtListener holds without star pagination produces a note saying
 * so, not the nearest paragraph — because a quotation attributed to the wrong
 * page is worse than no quotation at all, and it is the kind of wrong that
 * survives all the way into a filing.
 */

import { parse } from "@recite/core";
import { Engine } from "@recite/engine";
import { describe, expect, it } from "vitest";

import {
  annotateCitations,
  annotationComment,
  CourtListenerClient,
  CourtListenerProvider,
  markupToText,
  matchForCitation,
  opinionPath,
  pinPage,
  quoteAtPage,
  quotePincite,
  RateLimiter,
  tidyQuotation,
  type CourtListenerMatch,
  type FetchLike,
  type HttpResponse,
} from "../src/index.js";

const TOKEN = "0123456789abcdef0123456789abcdef01234567";
const ORIGIN = "https://www.courtlistener.com";
const OPINION = `${ORIGIN}/api/rest/v4/opinions/108713/`;

const instant = () =>
  new RateLimiter({ perWindow: 1000, sleep: () => Promise.resolve() });

function respond(status: number, body: unknown): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const client = (fetchImpl: FetchLike) =>
  new CourtListenerClient({ token: TOKEN, fetch: fetchImpl });

/** An opinion body in the shape `html_with_citations` arrives in. */
const OPINION_HTML = `
<p>Syllabus omitted.</p>
<span class="star-pagination">*677</span>
<p>Two working principles underlie our decision in <em>Twombly</em>.</p>
<span class="star-pagination">*678</span>
<p>Threadbare recitals of the elements of a cause of action, supported by mere
conclusory statements, do not suffice. Rule 8 marks a notable and generous
departure from the hypertechnical, code-pleading regime of a prior era.</p>
<span class="star-pagination">*679</span>
<p>Determining whether a complaint states a plausible claim for relief is a
context-specific task.</p>
`;

describe("reading markup down to text", () => {
  it("normalises every dialect of star pagination to the same marker", () => {
    expect(markupToText('<span class="star-pagination">*678</span>a')).toContain(
      "*678",
    );
    expect(
      markupToText('<page-number label="678" citation-index="1">*678</page-number>b'),
    ).toContain("*678");
    // The plain-text version already uses this form, so nothing to do.
    expect(markupToText("some text *678 more")).toContain("*678");
  });

  it("drops script and style content rather than quoting it", () => {
    expect(markupToText("<style>p{color:red}</style><p>Held.</p>")).toBe("Held.");
  });

  it("decodes the entities a citation is made of", () => {
    expect(markupToText("<p>11 U.S.C. &sect; 362 &mdash; &ldquo;stay&rdquo;</p>")).toBe(
      "11 U.S.C. § 362 — “stay”",
    );
    expect(markupToText("<p>&#167; 1983 &#x2014; here</p>")).toBe("§ 1983 — here");
  });

  it("keeps paragraphs apart so two sentences do not run together", () => {
    expect(markupToText("<p>First.</p><p>Second.</p>")).toBe("First.\nSecond.");
  });
});

describe("quoting a page", () => {
  const text = markupToText(OPINION_HTML);

  it("starts at the marker, not at the top of the opinion", () => {
    expect(quoteAtPage(text, "678")).toMatch(/^Threadbare recitals/);
  });

  it("returns nothing when the page is not marked", () => {
    expect(quoteAtPage(text, "999")).toBeUndefined();
  });

  it("does not mistake a prefix of a page number for the page", () => {
    // `*67` must not match inside `*678`, and `*678` must not match `*6789`.
    expect(quoteAtPage("*678 body", "67")).toBeUndefined();
    expect(quoteAtPage("*6789 body", "678")).toBeUndefined();
  });

  it("refuses a page that is not a page", () => {
    expect(quoteAtPage(text, "678a")).toBeUndefined();
    expect(quoteAtPage(text, "passim")).toBeUndefined();
  });

  it("cuts at a sentence when it can", () => {
    const quoted = tidyQuotation("One sentence ends here. And another begins.", 30);
    expect(quoted).toBe("One sentence ends here.");
  });

  it("cuts at a word and marks the cut when it cannot", () => {
    const quoted = tidyQuotation("aaaa bbbb cccc dddd eeee ffff gggg", 12);
    expect(quoted).toBe("aaaa bbbb…");
  });

  it("leaves a short passage exactly as it is", () => {
    expect(tidyQuotation("  Held: reversed.  ", 400)).toBe("Held: reversed.");
  });
});

describe("following a link the network supplied", () => {
  it("accepts an opinion URL on the configured origin", () => {
    expect(opinionPath(OPINION, ORIGIN)).toBe("/api/rest/v4/opinions/108713/");
  });

  it("refuses one that points somewhere else", () => {
    // A response must not be able to decide where the next request goes.
    expect(opinionPath("https://evil.example/api/rest/v4/opinions/1/", ORIGIN)).toBe(
      undefined,
    );
    expect(opinionPath(`${ORIGIN}/api/rest/v4/dockets/1/`, ORIGIN)).toBe(undefined);
  });
});

describe("fetching a pincite", () => {
  it("returns the passage at the page", async () => {
    const quotation = await quotePincite(
      client(() =>
        Promise.resolve(respond(200, { html_with_citations: OPINION_HTML })),
      ),
      [OPINION],
      "678",
      `${ORIGIN}/opinion/108713/iqbal/`,
    );

    expect(quotation.text).toMatch(/^Threadbare recitals/);
    expect(quotation.url).toBe(`${ORIGIN}/opinion/108713/iqbal/#p678`);
  });

  it("tries the concurrence when the page is not in the majority", async () => {
    const second = `${ORIGIN}/api/rest/v4/opinions/999/`;
    const bodies: Record<string, string> = {
      "/api/rest/v4/opinions/108713/":
        '<p>Majority.</p><span class="star-pagination">*1</span>',
      "/api/rest/v4/opinions/999/":
        '<span class="star-pagination">*700</span><p>Dissenting.</p>',
    };
    const seen: string[] = [];

    const quotation = await quotePincite(
      client((url) => {
        const path = url.slice(ORIGIN.length);
        seen.push(path);
        return Promise.resolve(respond(200, { plain_text: bodies[path] }));
      }),
      [OPINION, second],
      "700",
      undefined,
    );

    expect(seen).toHaveLength(2);
    expect(quotation.text).toBe("Dissenting.");
  });

  it("says the page is unmarked rather than quoting the nearest paragraph", async () => {
    const quotation = await quotePincite(
      client(() => Promise.resolve(respond(200, { plain_text: "No markers here." }))),
      [OPINION],
      "678",
      undefined,
    );

    expect(quotation.text).toBeUndefined();
    expect(quotation.unpaginated).toBe(true);
    expect(quotation.note).toMatch(/not marked/);
  });

  it("quotes the opening when the pin cite is the opinion's own first page", async () => {
    // `556 U.S. 662, 662` points at the page the opinion starts on, which is
    // exactly the page that never carries a marker.
    const quotation = await quotePincite(
      client(() => Promise.resolve(respond(200, { plain_text: "Justice Kennedy." }))),
      [OPINION],
      "662",
      undefined,
      { firstPage: "662" },
    );

    expect(quotation.text).toBe("Justice Kennedy.");
    expect(quotation.note).toMatch(/where the opinion begins/);
  });

  it("says so when CourtListener holds no text", async () => {
    const quotation = await quotePincite(
      client(() => Promise.resolve(respond(200, { plain_text: "" }))),
      [OPINION],
      "678",
      undefined,
    );
    expect(quotation.note).toMatch(/no text/);
  });

  it("does not follow an opinion URL on another host", async () => {
    let called = false;
    const quotation = await quotePincite(
      client(() => {
        called = true;
        return Promise.resolve(respond(200, {}));
      }),
      ["https://evil.example/api/rest/v4/opinions/1/"],
      "678",
      undefined,
    );

    expect(called).toBe(false);
    expect(quotation.note).toMatch(/no opinion text/);
  });

  it("carries a transport failure through as a note, not a quotation", async () => {
    const quotation = await quotePincite(
      client(() => Promise.reject(new Error("network down"))),
      [OPINION],
      "678",
      undefined,
    );
    expect(quotation.text).toBeUndefined();
    expect(quotation.note).toMatch(/Could not reach CourtListener/);
  });
});

// -------------------------------------------------------------- annotate ---

const IQBAL_CLUSTER = {
  id: 108713,
  case_name: "Ashcroft v. Iqbal",
  date_filed: "2009-05-18",
  absolute_url: "/opinion/108713/ashcroft-v-iqbal/",
  court_id: "scotus",
  sub_opinions: [OPINION],
};

/** A fetch that answers the lookup endpoint and the opinion endpoint. */
function courtListener(over: { clusters?: unknown[]; status?: number } = {}) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = (url) => {
    calls.push(url);
    if (url.includes("citation-lookup")) {
      return Promise.resolve(
        respond(200, [
          {
            citation: "556 U.S. 662",
            status: over.status ?? 200,
            clusters: over.clusters ?? [IQBAL_CLUSTER],
          },
        ]),
      );
    }
    return Promise.resolve(respond(200, { html_with_citations: OPINION_HTML }));
  };
  return { fetchImpl, calls };
}

async function annotated(text: string, over?: Parameters<typeof courtListener>[0]) {
  const { fetchImpl, calls } = courtListener(over);
  const extraction = parse(text);
  const subject = new CourtListenerProvider({
    client: client(fetchImpl),
    limiter: instant(),
  });
  await subject.verify(extraction.citations);

  const result = await annotateCitations(extraction, subject.lookups, {
    client: client(fetchImpl),
    limiter: instant(),
  });
  return { ...result, calls, extraction };
}

describe("annotating a document", () => {
  it("attaches the passage to the citation that names the page", async () => {
    const { annotations } = await annotated(
      "Ashcroft v. Iqbal, 556 U.S. 662, 678 (2009).",
    );

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      caseName: "Ashcroft v. Iqbal",
      pinCite: "678",
      source: "CourtListener",
    });
    expect(annotations[0]!.quotation).toMatch(/^Threadbare recitals/);
  });

  it("anchors the comment on the citation, not on the whole sentence", async () => {
    const text = "As held in Ashcroft v. Iqbal, 556 U.S. 662, 678 (2009), pleading.";
    const { annotations } = await annotated(text);
    const { span } = annotations[0]!;
    expect(text.slice(span.start, span.end)).toContain("556 U.S. 662");
  });

  it("annotates a short form from the full citation it points back to", async () => {
    // This is most of the value: `Id. at 678` is where the brief makes its
    // point, and it has nothing of its own to look up.
    const { annotations } = await annotated(
      "Ashcroft v. Iqbal, 556 U.S. 662 (2009). Id. at 678.",
    );

    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.anchorText).toMatch(/Id\./);
    expect(annotations[0]!.quotation).toMatch(/^Threadbare recitals/);
  });

  it("leaves a citation with no pin cite alone", async () => {
    const { annotations } = await annotated("Ashcroft v. Iqbal, 556 U.S. 662 (2009).");
    expect(annotations).toEqual([]);
  });

  it("refuses to quote an ambiguous citation", async () => {
    // Two decisions carry the citation, so quoting the first would attribute
    // words to a case the author may not have cited.
    const { annotations } = await annotated("556 U.S. 662, 678 (2009).", {
      status: 300,
      clusters: [IQBAL_CLUSTER, { ...IQBAL_CLUSTER, id: 2 }],
    });
    expect(annotations).toEqual([]);
  });

  it("fetches one opinion however many pin cites land on the page", async () => {
    const { calls } = await annotated(
      "Iqbal, 556 U.S. 662, 678 (2009). See also Iqbal, 556 U.S. 662, 678 (2009).",
    );
    expect(calls.filter((url) => url.includes("/opinions/"))).toHaveLength(1);
  });

  it("says what it left alone when it hits its ceiling", async () => {
    const { fetchImpl } = courtListener();
    const extraction = parse(
      "Iqbal, 556 U.S. 662, 678 (2009). Id. at 679. Id. at 677.",
    );
    const subject = new CourtListenerProvider({
      client: client(fetchImpl),
      limiter: instant(),
    });
    await subject.verify(extraction.citations);

    const { annotations, notices } = await annotateCitations(
      extraction,
      subject.lookups,
      { client: client(fetchImpl), limiter: instant(), maxAnnotations: 2 },
    );

    expect(annotations).toHaveLength(2);
    expect(notices.join(" ")).toMatch(/first 2 of 3 pin cites/);
  });

  it("reports how many pin cites it could not quote", async () => {
    const fetchImpl: FetchLike = (url) =>
      url.includes("citation-lookup")
        ? Promise.resolve(respond(200, [{ status: 200, clusters: [IQBAL_CLUSTER] }]))
        : Promise.resolve(respond(200, { plain_text: "No markers at all." }));

    const extraction = parse("Iqbal, 556 U.S. 662, 678 (2009).");
    const subject = new CourtListenerProvider({
      client: client(fetchImpl),
      limiter: instant(),
    });
    await subject.verify(extraction.citations);

    const { annotations, notices } = await annotateCitations(
      extraction,
      subject.lookups,
      { client: client(fetchImpl), limiter: instant() },
    );

    expect(annotations[0]!.quotation).toBeUndefined();
    expect(annotations[0]!.note).toMatch(/not marked/);
    expect(notices.join(" ")).toMatch(/could not be quoted/);
  });
});

describe("the comment a document ends up carrying", () => {
  it("names the case, the page, the words and the source", async () => {
    const { annotations } = await annotated("Iqbal, 556 U.S. 662, 678 (2009).");
    const comment = annotationComment(annotations[0]!);

    expect(comment).toContain("Ashcroft v. Iqbal, at 678");
    expect(comment).toContain("“Threadbare recitals");
    expect(comment).toContain("CourtListener: https://www.courtlistener.com/opinion/");
    // The caveat is not decoration: a quotation in a margin reads as verified
    // unless it says otherwise.
    expect(comment).toMatch(/not a substitute for reading the opinion/);
  });
});

describe("the pieces the annotator is built from", () => {
  it("takes the first page of a multi-page pin cite", () => {
    const [citation] = parse("Iqbal, 556 U.S. 662, 678-80 (2009).").citations;
    expect(pinPage(citation!)).toBe("678");
  });

  it("has no page for passim", () => {
    const { citations } = parse("Iqbal, 556 U.S. 662, passim (2009).");
    expect(pinPage(citations[0]!)).toBeUndefined();
  });

  it("resolves a short form through the resource it shares", () => {
    const extraction = parse("Iqbal, 556 U.S. 662 (2009). Id. at 678.");
    const match: CourtListenerMatch = {
      citationIndex: 0,
      key: "556 U.S. 662",
      status: "found",
      clusters: [],
    };
    const matches = new Map([[0, match]]);
    const short = extraction.citations[1]!;
    expect(matchForCitation(short, extraction, matches)).toBe(match);
  });
});

describe("with the engine", () => {
  it("reports a citation CourtListener does not carry", async () => {
    // The Mata lesson, with a real database behind it: every offline rule
    // passes on `925 F.3d 1339`, and only a lookup catches it.
    const fetchImpl: FetchLike = () =>
      Promise.resolve(respond(200, [{ status: 404, clusters: [] }]));

    const engine = new Engine({
      provider: new CourtListenerProvider({
        client: client(fetchImpl),
        limiter: instant(),
      }),
      currentYear: 2026,
    });

    const result = await engine.check(
      "Varghese v. China Southern Airlines Co., 925 F.3d 1339 (11th Cir. 2019).",
    );
    const vf001 = result.diagnostics.filter(
      (d: { ruleId: string }) => d.ruleId === "VF001",
    );
    expect(vf001).toHaveLength(1);
    expect(vf001[0]!.message).toContain("CourtListener");
  });

  it("reports a real citation carrying the wrong case name", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(respond(200, [{ status: 200, clusters: [IQBAL_CLUSTER] }]));

    const engine = new Engine({
      provider: new CourtListenerProvider({
        client: client(fetchImpl),
        limiter: instant(),
      }),
      currentYear: 2026,
    });

    const result = await engine.check("Smith v. Jones, 556 U.S. 662 (2009).");
    expect(result.diagnostics.map((d: { ruleId: string }) => d.ruleId)).toContain(
      "VF003",
    );
  });
});
