/** The reporter and court tables, and the queries over them. */

import { describe, expect, it } from "vitest";

import {
  candidateCourts,
  courtAbbrev,
  courtById,
  courtExistedIn,
  resolveCourt,
  splitParenthetical,
} from "../src/courts.js";
import { COURTS } from "../src/data/courts.js";
import { REPORTERS } from "../src/data/reporters.js";
import {
  canonicalForVariation,
  differsOnlyCosmetically,
  editionsCoveringYear,
  findReporter,
  isKnownReporter,
  reporterCovers,
  seriesEditions,
  suggestReporters,
} from "../src/reporters.js";

describe("reporter table", () => {
  it("has no duplicate abbreviations", () => {
    const abbrevs = REPORTERS.map((r) => r.abbrev);
    expect(new Set(abbrevs).size).toBe(abbrevs.length);
  });

  it("never ends a series before it starts", () => {
    for (const edition of REPORTERS) {
      if (edition.end !== null)
        expect(edition.end).toBeGreaterThanOrEqual(edition.start);
    }
  });

  it("has a continuous Federal Reporter series", () => {
    expect(seriesEditions("F.3d").map((e) => e.abbrev)).toEqual([
      "F.",
      "F.2d",
      "F.3d",
      "F.4th",
    ]);
  });
});

describe("findReporter", () => {
  it.each(["S. Ct.", "S.Ct.", "S.  Ct."])("finds a reporter written %s", (written) => {
    expect(findReporter(written)?.abbrev).toBe("S. Ct.");
  });

  it("finds L. Ed. 2d written without spaces", () => {
    expect(findReporter("L.Ed.2d")?.abbrev).toBe("L. Ed. 2d");
  });

  it("returns nothing for an abbreviation not in the table", () => {
    expect(findReporter("Xyz. 4th")).toBeUndefined();
    expect(isKnownReporter("Xyz. 4th")).toBe(false);
  });
});

describe("coverage", () => {
  it.each([
    [1992, false],
    [1993, true],
    [2019, true],
    [2022, false],
  ])("F.3d covers %i: %s", (year, covered) => {
    expect(reporterCovers(findReporter("F.3d")!, year)).toBe(covered);
  });

  it("names the sibling edition that covers a year", () => {
    expect(editionsCoveringYear("F.3d", 1950).map((e) => e.abbrev)).toEqual(["F.2d"]);
  });

  it("returns nothing when no edition of a series covers the year", () => {
    expect(editionsCoveringYear("F.3d", 1700)).toEqual([]);
  });
});

describe("variations and cosmetic differences", () => {
  it("maps a substantively wrong abbreviation to the right one", () => {
    expect(canonicalForVariation("Fed. Rep.")).toBe("F.");
  });

  it.each([
    ["S.Ct.", "S. Ct.", true],
    ["U. S.", "U.S.", true],
    ["L.Ed.2d", "L. Ed. 2d", true],
    ["Fed. Rep.", "F.", false],
  ])("%s vs %s is cosmetic: %s", (written, canonical, cosmetic) => {
    expect(differsOnlyCosmetically(written, canonical)).toBe(cosmetic);
  });
});

describe("suggestReporters", () => {
  it("suggests the intended reporter for a typo", () => {
    expect(suggestReporters("Cal. Rprt. 3d")).toContain("Cal. Rptr. 3d");
  });

  it("suggests nothing for nonsense", () => {
    expect(suggestReporters("Xyzzy Quux")).toEqual([]);
  });

  it("never suggests an abbreviation that is already correct", () => {
    expect(suggestReporters("F.3d")).not.toContain("F.3d");
  });

  it("is safe on empty input", () => {
    expect(suggestReporters("")).toEqual([]);
  });
});

describe("court table", () => {
  it("has no duplicate ids", () => {
    const ids = COURTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps an id to its abbreviation", () => {
    expect(courtAbbrev("ca9")).toBe("9th Cir.");
    expect(courtAbbrev("nysd")).toBe("S.D.N.Y.");
  });

  it("knows when a court existed", () => {
    const ca11 = courtById("ca11")!;
    expect(courtExistedIn(ca11, 2019)).toBe(true);
    // The Eleventh Circuit was split off from the Fifth in 1981.
    expect(courtExistedIn(ca11, 1975)).toBe(false);
  });
});

describe("resolveCourt", () => {
  it("resolves a standard abbreviation", () => {
    expect(resolveCourt("11th Cir.")?.id).toBe("ca11");
  });

  it("resolves a spelled-out district", () => {
    expect(resolveCourt("Southern District of New York")?.id).toBe("nysd");
  });

  it("declines to answer for an abbreviation two courts share", () => {
    // `App. Div.` is New York's and New Jersey's alike.
    expect(resolveCourt("App. Div.")).toBeUndefined();
    expect(candidateCourts("App. Div.")).toHaveLength(2);
  });

  it.each(["en banc", "per curiam", "citations omitted", ""])(
    "declines to treat %j as a court",
    (text) => {
      expect(resolveCourt(text)).toBeUndefined();
    },
  );
});

describe("splitParenthetical", () => {
  it.each([
    ["1968", undefined, 1968],
    ["11th Cir. 2019", "11th Cir.", 2019],
    ["Tex. App. Sept. 25, 2019", "Tex. App.", 2019],
    ["Ga. Ct. App. June 5, 2017", "Ga. Ct. App.", 2017],
    ["S.D.N.Y. Mar. 1, 2023", "S.D.N.Y.", 2023],
  ])("splits (%s)", (body, courtText, year) => {
    const split = splitParenthetical(body);
    expect(split.courtText).toBe(courtText);
    expect(split.year).toBe(year);
  });

  it("reports where the court text sits so it can be rewritten", () => {
    const split = splitParenthetical("Tex. App. Sept. 25, 2019");
    expect(split.courtOffset).toBe(0);
  });
});
