/**
 * Reading the section part of a statute citation.
 *
 * The interesting cases are the two the pattern cannot tell apart on its own:
 * a hyphen that spans two sections (`103-107`) and a hyphen that belongs to a
 * rule's name (`240.10b-5`).
 */

import { describe, expect, it } from "vitest";

import { parse } from "../src/parse.js";
import {
  dropsSectionDigits,
  expandSectionEnd,
  parseSections,
} from "../src/statutes.js";

describe("parseSections", () => {
  it("reads a single section", () => {
    expect(parseSections("501")).toEqual({ items: ["501"], join: "single" });
    expect(parseSections("362(a)(1)")).toEqual({
      items: ["362(a)(1)"],
      join: "single",
    });
  });

  it("reads a list", () => {
    expect(parseSections("1544, 1546")).toEqual({
      items: ["1544", "1546"],
      join: "list",
    });
  });

  it("reads a span, keeping the endpoints as written", () => {
    expect(parseSections("103-107")).toEqual({
      items: ["103", "107"],
      join: "span",
      span: ["103", "107"],
    });
    expect(parseSections("103-07")).toEqual({
      items: ["103", "07"],
      join: "span",
      span: ["103", "07"],
    });
  });

  it("reads a span written with an en dash", () => {
    expect(parseSections("103–107")?.span).toEqual(["103", "107"]);
  });

  it("keeps a hyphen that belongs to a rule's name", () => {
    // Rule 10b-5 is one section. Reading the hyphen as a span would have
    // ReCite report a Bluebook error in a correct securities citation.
    expect(parseSections("240.10b-5")).toEqual({
      items: ["240.10b-5"],
      join: "single",
    });
    expect(parseSections("1.401(k)-1")).toEqual({
      items: ["1.401(k)-1"],
      join: "single",
    });
  });

  it("keeps name hyphens inside a list", () => {
    expect(parseSections("240.10b-5, 240.14a-9")).toEqual({
      items: ["240.10b-5", "240.14a-9"],
      join: "list",
    });
  });

  it("returns nothing for nothing", () => {
    expect(parseSections(undefined)).toBeUndefined();
    expect(parseSections("   ")).toBeUndefined();
  });
});

describe("section spans versus page ranges", () => {
  // Rule 3.3(b) keeps every digit; rule 3.2(a) drops the repetitious ones.
  // Getting the two the same way round is the mistake worth guarding.
  it("knows when digits were dropped", () => {
    expect(dropsSectionDigits("103", "07")).toBe(true);
    expect(dropsSectionDigits("103", "107")).toBe(false);
    expect(dropsSectionDigits("1204", "08")).toBe(true);
  });

  it("does not judge endpoints it cannot compare", () => {
    expect(dropsSectionDigits("240.10b", "5")).toBe(false);
    expect(dropsSectionDigits("103", "1a")).toBe(false);
  });

  it("restores the dropped digits", () => {
    expect(expandSectionEnd("103", "07")).toBe("107");
    expect(expandSectionEnd("1204", "08")).toBe("1208");
    expect(expandSectionEnd("103", "107")).toBe("107");
  });
});

describe("what the parser hands the section rules", () => {
  const only = (text: string) => parse(text).citations[0];

  it("captures the section symbol as written", () => {
    expect(only("18 U.S.C. §§ 1544, 1546 (2012).")?.sectionSymbol).toBe("§§");
    expect(only("17 U.S.C. § 501 (2012).")?.sectionSymbol).toBe("§");
  });

  it("captures every section, not just the first", () => {
    expect(only("18 U.S.C. §§ 1544, 1546 (2012).")?.sections).toBe("1544, 1546");
    expect(only("17 U.S.C. §§ 103-107 (2012).")?.sections).toBe("103-107");
  });

  it("stops at the sentence period", () => {
    const citation = only("18 U.S.C. §§ 1544, 1546.");
    expect(citation?.text).toBe("18 U.S.C. §§ 1544, 1546");
    expect(citation?.sections).toBe("1544, 1546");
  });

  it("does not swallow the authority after a semicolon", () => {
    // A semicolon ends the statute and begins the next citation. Treating it
    // as a section separator would eat the case that follows.
    const result = parse("See 11 U.S.C. § 362(a); 556 U.S. 662 (2009).");
    expect(result.citations.map((c) => c.text)).toEqual([
      "11 U.S.C. § 362(a)",
      "556 U.S. 662",
    ]);
  });

  it("keeps the year parenthetical out of the sections", () => {
    expect(only("17 U.S.C. § 501 (2012 & Supp. II 2014).")?.sections).toBe("501");
  });
});
