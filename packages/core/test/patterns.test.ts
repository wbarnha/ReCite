/** The regexes themselves, tested away from the parser that drives them. */

import { describe, expect, it } from "vitest";

import { buildPatterns, reporterAlternatives } from "../src/patterns.js";
import { parse } from "../src/parse.js";

describe("reporter spacing", () => {
  // `flexibleAbbrev` used to build a per-abbreviation pattern so that `S.Ct.`
  // and `S. Ct.` both matched. Reporters are matched by shape now and identity
  // is settled by `findReporter`, which squashes spacing — so the behaviour is
  // asserted where it now lives, on the parse.
  it.each([
    ["119 S. Ct. 662 (1999).", "S. Ct."],
    ["119 S.Ct. 662 (1999).", "S.Ct."],
    ["20 L.Ed.2d 835 (1968).", "L.Ed.2d"],
    ["905 F.Supp.2d 121 (2012).", "F.Supp.2d"],
    ["1 F. App'x 2 (2001).", "F. App'x"],
  ])("reads the reporter in %s however it is spaced", (text, written) => {
    expect(parse(text).citations[0]?.reporter).toBe(written);
  });

  it("resolves every spacing to the same canonical reporter", () => {
    for (const text of ["119 S. Ct. 662 (1999).", "119 S.Ct. 662 (1999)."]) {
      expect(parse(text).citations[0]?.reporterCanonical).toBe("S. Ct.");
    }
  });
});

describe("reporter matching", () => {
  it("prefers the longest reporter that still leaves a page number", () => {
    // This used to be a property of the alternation, which listed longer
    // abbreviations first so `F. Supp. 2d` beat `F. Supp.`. There is no
    // alternation any more — the shape grows lazily until a bare page can
    // follow — so the property is now asserted on the outcome, which is what
    // mattered all along.
    const [supp] = parse("905 F. Supp. 2d 121 (S.D.N.Y. 2012).").citations;
    expect(supp?.reporter).toBe("F. Supp. 2d");

    const [lawyers] = parse("20 L. Ed. 2d 835 (1968).").citations;
    expect(lawyers?.reporter).toBe("L. Ed. 2d");
  });

  it("knows the reporters the vendored table carries", () => {
    // Around 3,600 spellings, against the fifty this project maintained by
    // hand. The count is not the point; that a state reporter nobody thought
    // to type in is now recognised is.
    const all = reporterAlternatives();
    expect(all.length).toBeGreaterThan(3000);
    expect(all).toContain("F. Supp. 2d");
    expect(all).toContain("Cal. Rptr. 3d");
  });

  it("refuses text that has the shape of a citation but names no reporter", () => {
    // The cost of matching a shape rather than a list. `123 Main Street 45`
    // fits the pattern exactly and must not be reported as a citation.
    expect(parse("123 Main Street 45").citations).toHaveLength(0);
    expect(parse("See 42 Wallaby Way 12 for details.").citations).toHaveLength(0);
  });

  it("contains no duplicates", () => {
    const all = reporterAlternatives();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("caseReporter", () => {
  const match = (text: string) => {
    const { caseReporter } = buildPatterns();
    caseReporter.lastIndex = 0;
    return caseReporter.exec(text);
  };

  it.each([
    ["925 F.3d 1339", "925", "F.3d", "1339"],
    ["556 U.S. 662", "556", "U.S.", "662"],
    ["905 F. Supp. 2d 121", "905", "F. Supp. 2d", "121"],
    ["20 L.Ed.2d 835", "20", "L.Ed.2d", "835"],
    ["119 S.Ct. 662", "119", "S.Ct.", "662"],
    ["360 N.J. Super. 360", "360", "N.J. Super.", "360"],
  ])("parses %s", (text, volume, reporter, page) => {
    const found = match(text);
    expect(found?.groups?.volume).toBe(volume);
    expect(found?.groups?.reporter?.trim()).toBe(reporter);
    expect(found?.groups?.page).toBe(page);
  });

  it("matches a citation broken across a line", () => {
    const found = match("174 F.3d\n366");
    expect(found?.groups?.page).toBe("366");
  });

  it("does not match a bare pair of numbers", () => {
    expect(match("filed 21 documents in 10 days")).toBeNull();
  });

  it("does not treat a statute as a U.S. Reports citation", () => {
    expect(match("11 U.S.C. § 362(a)")).toBeNull();
  });
});

describe("shortForm", () => {
  it("parses `at` short cites", () => {
    const { shortForm } = buildPatterns();
    const found = shortForm.exec("516 F.3d at 1254");
    expect(found?.groups).toMatchObject({ volume: "516", pin: "1254" });
  });
});

describe("database", () => {
  const match = (text: string) => {
    const { database } = buildPatterns();
    database.lastIndex = 0;
    return database.exec(text);
  };

  it.each([
    ["2019 WL 4639462", "2019", "WL", "4639462"],
    ["2017 WL 2418825", "2017", "WL", "2418825"],
  ])("parses %s", (text, year, db, num) => {
    expect(match(text)?.groups).toMatchObject({ year, db, num });
  });

  it("parses a LEXIS citation", () => {
    expect(match("2017 U.S. App. LEXIS 12345")?.groups?.num).toBe("12345");
  });

  it("ignores a bare year", () => {
    expect(match("decided in 2019 by the court")).toBeNull();
  });
});

describe("neutral", () => {
  const match = (text: string) => {
    const { neutral } = buildPatterns();
    neutral.lastIndex = 0;
    return neutral.exec(text);
  };

  it("parses an Illinois public-domain citation with a district", () => {
    expect(match("2013 IL App (1st) 111279-U")?.groups).toMatchObject({
      year: "2013",
      juris: "IL App",
      div: "1st",
      num: "111279-U",
    });
  });

  it("parses a citation without a district", () => {
    expect(match("2019 ND 12")?.groups).toMatchObject({ juris: "ND", num: "12" });
  });

  it("ignores a jurisdiction code that issues no neutral citations", () => {
    expect(match("2019 ZZ 12")).toBeNull();
  });
});

describe("statute", () => {
  const match = (text: string) => {
    const { statute } = buildPatterns();
    statute.lastIndex = 0;
    return statute.exec(text);
  };

  it.each([
    ["11 U.S.C. § 362(a)", "362(a)"],
    ["11 U.S.C. § 362(a)(1)", "362(a)(1)"],
    ["28 U.S.C. § 1331", "1331"],
  ])("parses %s", (text, section) => {
    expect(match(text)?.groups?.section).toBe(section);
  });

  it("tolerates the section symbol being absent", () => {
    expect(match("11 U.S.C. 362")?.groups?.section).toBe("362");
  });
});

describe("id", () => {
  it("captures the pin cite when present", () => {
    const { id } = buildPatterns();
    expect(id.exec("Id. at 166")?.groups?.pin).toBe("166");
  });

  it("matches a bare Id.", () => {
    const { id } = buildPatterns();
    expect(id.exec("Id.")?.[0]).toBe("Id.");
  });

  it("does not match inside another word", () => {
    const { id } = buildPatterns();
    id.lastIndex = 0;
    expect(id.exec("Invalid. The motion")).toBeNull();
  });
});

describe("pinCite", () => {
  const { pinCite } = buildPatterns();

  it.each([
    [", 598", "598"],
    [", 371-72", "371-72"],
    [", 1254,", "1254"],
  ])("parses %s", (text, pin) => {
    expect(pinCite.exec(text)?.groups?.pin?.replace(/\s+/g, "")).toBe(pin);
  });

  it("rejects text that is not only a pin cite", () => {
    expect(pinCite.exec(", 88 S. Ct. 1753")).toBeNull();
  });
});

describe("pattern instances are independent", () => {
  it("does not share lastIndex between builds", () => {
    const a = buildPatterns();
    const b = buildPatterns();
    a.caseReporter.exec("925 F.3d 1339");
    expect(a.caseReporter.lastIndex).toBeGreaterThan(0);
    expect(b.caseReporter.lastIndex).toBe(0);
  });
});
