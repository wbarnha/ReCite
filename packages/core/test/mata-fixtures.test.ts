/**
 * The parser, driven by citations transcribed from a real filing.
 *
 * See `fixtures/mata-avianca.ts` for provenance. Every fixture is table-driven
 * so a failure names the format that broke rather than a line number.
 */

import { describe, expect, it } from "vitest";

import type { ParsedCitation } from "../src/model.js";
import { parse } from "../src/parse.js";
import type { ExpectedCitation } from "./fixtures/mata-avianca.js";
import { MATA_EXCERPT, MATA_FIXTURES } from "./fixtures/mata-avianca.js";

function assertMatches(
  actual: ParsedCitation,
  expected: ExpectedCitation,
  fixtureCitations: readonly ParsedCitation[],
): void {
  expect(actual.kind).toBe(expected.kind);
  expect(actual.text.replace(/\s+/g, " ")).toBe(expected.text.replace(/\s+/g, " "));

  const fields = [
    "volume",
    "reporter",
    "reporterCanonical",
    "page",
    "year",
    "courtId",
    "courtText",
    "caseName",
    "pinCite",
    "database",
    "neutralBody",
  ] as const;

  for (const field of fields) {
    if (expected[field] === undefined) continue;
    expect(actual[field], `${expected.text} -> ${field}`).toBe(expected[field]);
  }

  if (expected.parallelOf !== undefined) {
    const target = fixtureCitations[expected.parallelOf];
    expect(actual.parallelOf, `${expected.text} -> parallelOf`).toBe(target?.index);
  }
}

describe("Mata v. Avianca citation fixtures", () => {
  for (const fixture of MATA_FIXTURES) {
    describe(`${fixture.id} (filing p.${fixture.page})`, () => {
      const result = parse(fixture.text);

      it(`finds ${fixture.expected.length} citation(s)`, () => {
        expect(
          result.citations.map((c) => c.text),
          fixture.exercises,
        ).toHaveLength(fixture.expected.length);
      });

      fixture.expected.forEach((expected, i) => {
        it(`parses ${JSON.stringify(expected.text)}`, () => {
          const actual = result.citations[i];
          expect(actual, `missing citation ${i}`).toBeDefined();
          assertMatches(actual!, expected, result.citations);
        });
      });

      it("every span indexes back to the source text", () => {
        for (const citation of result.citations) {
          expect(fixture.text.slice(citation.span.start, citation.span.end)).toBe(
            citation.text,
          );
        }
      });
    });
  }
});

describe("the filing as one document", () => {
  const result = parse(MATA_EXCERPT);

  it("finds every citation across the argument section", () => {
    // 15 reporter citations (including 4 parallels), 2 Westlaw numbers,
    // 1 neutral citation, 1 statute and 1 `Id.`
    expect(result.citations.length).toBeGreaterThanOrEqual(19);
  });

  it("keeps citations in document order", () => {
    const starts = result.citations.map((c) => c.span.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("no two citations overlap", () => {
    const sorted = [...result.citations].sort((a, b) => a.span.start - b.span.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.span.start).toBeGreaterThanOrEqual(sorted[i - 1]!.span.end);
    }
  });

  it("attaches the `Id.` to the citation before it", () => {
    const id = result.citations.find((c) => c.kind === "id");
    expect(id?.resourceKey).toBe("525 U.S. 155");
  });

  it("groups the three reporters for Kaiser Steel as one authority", () => {
    const kaiser = result.citations.find((c) => c.text === "391 U.S. 593");
    expect(kaiser).toBeDefined();

    const parallels = result.citations.filter((c) => c.parallelOf === kaiser!.index);
    expect(parallels.map((c) => c.text)).toEqual(["88 S. Ct. 1753", "20 L.Ed.2d 835"]);
  });

  it("recognises the Supreme Court Reporter spelled both ways", () => {
    const spellings = result.citations
      .filter((c) => c.reporterCanonical === "S. Ct.")
      .map((c) => c.reporter);

    // The filing writes it `S.Ct.` on one line and `S. Ct.` two lines later.
    expect(new Set(spellings)).toEqual(new Set(["S.Ct.", "S. Ct."]));
  });

  it("reads the fabricated Varghese citation as well-formed", () => {
    // Nothing about its *format* is wrong, which is exactly why format rules
    // alone cannot catch a citation like this one.
    const varghese = result.citations.find((c) => c.caseName?.startsWith("Varghese"));
    expect(varghese).toMatchObject({
      volume: "925",
      reporterCanonical: "F.3d",
      page: "1339",
      year: 2019,
      courtId: "ca11",
    });
  });
});
