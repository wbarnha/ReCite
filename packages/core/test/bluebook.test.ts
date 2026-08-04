/** Page ranges, pin cites, and the edition/style profiles. */

import { describe, expect, it } from "vitest";

import {
  abbreviateRange,
  allowsTightenedAbbreviations,
  DASH_CHARACTERS,
  describeProfile,
  expandTo,
  parsePinCite,
  spacingVariant,
} from "../src/bluebook.js";
import { parse } from "../src/parse.js";
import { buildPatterns } from "../src/patterns.js";

describe("dash handling", () => {
  // Rule 3.2(a) prints an en dash; keyboards give a hyphen; autocorrect gives
  // an em dash; PDF extraction gives figure dashes and non-breaking hyphens.
  const NAMED: ReadonlyArray<readonly [string, string]> = [
    ["hyphen-minus", "-"],
    ["hyphen", "‐"],
    ["non-breaking hyphen", "‑"],
    ["figure dash", "‒"],
    ["en dash", "–"],
    ["em dash", "—"],
    ["horizontal bar", "―"],
    ["minus sign", "−"],
  ];

  it.each(NAMED)("parses a range written with a %s", (_name, dash) => {
    const pin = parsePinCite(`371${dash}72`);
    expect(pin?.ranges).toEqual([{ from: 371, to: 372 }]);
  });

  it.each(NAMED)("tolerates spaces around a %s", (_name, dash) => {
    expect(parsePinCite(`371 ${dash} 72`)?.ranges).toEqual([{ from: 371, to: 372 }]);
  });

  it("covers every dash the module declares", () => {
    for (const dash of DASH_CHARACTERS) {
      expect(parsePinCite(`10${dash}12`)?.ranges).toHaveLength(1);
    }
  });

  it.each(NAMED)("finds a pin cite in a citation using a %s", (_name, dash) => {
    const [citation] = parse(
      `Miller v. United Airlines, Inc., 174 F.3d 366, 371${dash}72 (2d Cir. 1999).`,
    ).citations;
    expect(citation?.pinCite).toBe(`371${dash}72`);
    expect(parsePinCite(citation?.pinCite)?.ranges).toEqual([{ from: 371, to: 372 }]);
  });
});

describe("parsePinCite", () => {
  it("reads a single page", () => {
    expect(parsePinCite("598")).toMatchObject({ pages: [598], ranges: [], first: 598 });
  });

  it("reads non-consecutive pages", () => {
    // Rule 3.2(a): commas separate discontinuous pages, digits are not dropped.
    expect(parsePinCite("123, 125, 130")?.pages).toEqual([123, 125, 130]);
  });

  it("reads a mix of pages and ranges", () => {
    const pin = parsePinCite("371-72, 380");
    expect(pin?.ranges).toEqual([{ from: 371, to: 372 }]);
    expect(pin?.pages).toEqual([380]);
  });

  it("reports the lowest page as `first`", () => {
    expect(parsePinCite("380, 371-72")?.first).toBe(371);
  });

  it("recognises passim", () => {
    expect(parsePinCite("passim")).toMatchObject({ passim: true, first: undefined });
  });

  it("returns nothing for text with no pages", () => {
    expect(parsePinCite("see generally")).toBeUndefined();
    expect(parsePinCite(undefined)).toBeUndefined();
  });

  it("keeps the raw text so a fix can target it", () => {
    expect(parsePinCite("  371–72  ")?.raw).toBe("371–72");
  });
});

describe("expandTo", () => {
  it.each([
    [371, "72", 372],
    [1204, "08", 1208],
    [98, "102", 102],
    [371, "372", 372],
    [1204, "1208", 1208],
  ])("%i-%s means %i", (from, written, expected) => {
    expect(expandTo(from, written)).toBe(expected);
  });

  it("leaves a range that would run backwards alone", () => {
    // `380-71` would expand to 371, which is before the start; taking it at
    // face value lets ST004 see the problem instead of hiding it.
    expect(expandTo(380, "71")).toBe(71);
  });
});

describe("abbreviateRange", () => {
  it.each([
    [371, 372, "72"],
    [1204, 1208, "08"],
    [190, 192, "92"],
    [98, 102, "102"],
    [371, 400, "400"],
  ])("%i to %i abbreviates to %s", (from, to, expected) => {
    expect(abbreviateRange(from, to)).toBe(expected);
  });

  it("always keeps at least two digits", () => {
    expect(abbreviateRange(1201, 1202).length).toBeGreaterThanOrEqual(2);
  });
});

describe("spacingVariant", () => {
  it.each([
    ["S. Ct.", "S. Ct.", "same"],
    ["S.Ct.", "S. Ct.", "tightened"],
    ["F.Supp.2d", "F. Supp. 2d", "tightened"],
    ["L.Ed.2d", "L. Ed. 2d", "tightened"],
    ["U. S.", "U.S.", "loosened"],
    ["F. 3d", "F.3d", "loosened"],
    ["Fed. Rep.", "F.", "different"],
  ] as const)("%s against %s is %s", (written, canonical, expected) => {
    expect(spacingVariant(written, canonical)).toBe(expected);
  });
});

describe("edition profiles", () => {
  it("permits tightened abbreviations in court filings from the 21st edition", () => {
    expect(allowsTightenedAbbreviations({ edition: 21, style: "practitioner" })).toBe(
      true,
    );
    expect(allowsTightenedAbbreviations({ edition: 22, style: "practitioner" })).toBe(
      true,
    );
  });

  it("does not permit them under the 20th edition", () => {
    expect(allowsTightenedAbbreviations({ edition: 20, style: "practitioner" })).toBe(
      false,
    );
  });

  it("does not permit them in scholarly writing", () => {
    // The allowance is a Bluepages rule; rule 6.1(a) spacing still governs
    // law review footnotes.
    expect(allowsTightenedAbbreviations({ edition: 21, style: "academic" })).toBe(
      false,
    );
    expect(allowsTightenedAbbreviations({ edition: 22, style: "academic" })).toBe(
      false,
    );
  });

  it("describes itself readably", () => {
    expect(describeProfile({ edition: 21, style: "practitioner" })).toBe(
      "Bluebook 21st edition, court documents",
    );
    expect(describeProfile({ edition: 20, style: "academic" })).toBe(
      "Bluebook 20th edition, scholarly writing",
    );
  });
});

describe("pin cite patterns", () => {
  const { pinCite, trailingPinCite } = buildPatterns();

  it.each([", 598", ", 371-72", ", 371–72", ", 123, 125, 130", ", passim"])(
    "matches %s as a complete pin cite",
    (text) => {
      pinCite.lastIndex = 0;
      expect(pinCite.exec(text)).not.toBeNull();
    },
  );

  it("does not mistake a parallel citation for a pin cite", () => {
    pinCite.lastIndex = 0;
    expect(pinCite.exec(", 88 S. Ct. 1753")).toBeNull();
  });

  it("reads a trailing pin cite before the parenthetical", () => {
    expect(trailingPinCite.exec(", 371-72 (2d Cir. 1999)")?.groups?.pin).toBe("371-72");
  });

  it("reads a multi-page trailing pin cite", () => {
    expect(trailingPinCite.exec(", 123, 130 (1999)")?.groups?.pin).toBe("123, 130");
  });
});

describe("ranges in real citation shapes", () => {
  it("keeps a range broken across a line", () => {
    const [citation] = parse(
      "Miller, 174 F.3d 366, 371-\n72 (2d Cir. 1999).",
    ).citations;
    expect(citation?.pinCite).toBe("371-72");
  });

  it("reads a range in an Id.", () => {
    const cites = parse("Iqbal, 556 U.S. 662 (2009). Id. at 678–80.").citations;
    expect(cites[1]?.pinCite).toBe("678–80");
    expect(parsePinCite(cites[1]?.pinCite)?.ranges).toEqual([{ from: 678, to: 680 }]);
  });

  it("reads a range in a short form", () => {
    const cites = parse(
      "Zicherman, 516 F.3d 1237 (11th Cir. 2008). See 516 F.3d at 1254-56.",
    ).citations;
    const short = cites.find((c) => c.kind === "short-form");
    expect(short?.pinCite).toBe("1254-56");
  });

  it("reads discontinuous pages after a citation", () => {
    const [citation] = parse("Iqbal, 556 U.S. 662, 678, 680, 684 (2009).").citations;
    expect(parsePinCite(citation?.pinCite)?.pages).toEqual([678, 680, 684]);
  });
});
