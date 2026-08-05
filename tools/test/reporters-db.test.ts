/**
 * The vendoring pipeline for `reporters-db`.
 *
 * The transform is tested against synthetic upstream JSON rather than the real
 * 900 KB file: these assert the decisions the transform makes, and a fixture
 * that has to be re-read every time upstream changes would assert whatever
 * upstream happens to contain.
 *
 * The last group is different in kind. It checks that the local overlay still
 * lands on reporters that exist, which is the one way this arrangement can
 * fail silently — an upstream rename would leave `scotusOnly` applying to
 * nothing, and `CT002` would simply stop catching a circuit court cited in the
 * Supreme Court's reporter.
 */

import { describe, expect, it } from "vitest";

import { readGeneratedRevision } from "./helpers/generated-revision.js";
import { rawUrl, readPin, sha256 } from "../reporters-db/fetch.js";
import type { UpstreamReporters } from "../reporters-db/transform.js";
import { transform } from "../reporters-db/transform.js";

const iso = (year: number | null) => (year === null ? null : `${year}-01-01T00:00:00`);

/** Minimal upstream-shaped input. */
function upstream(
  families: Record<
    string,
    {
      cite_type?: string;
      name?: string;
      editions: Record<string, [number | null, number | null]>;
      variations?: Record<string, string | string[]>;
    }[]
  >,
): UpstreamReporters {
  const out: UpstreamReporters = {};
  for (const [family, entries] of Object.entries(families)) {
    out[family] = entries.map((entry) => ({
      cite_type: entry.cite_type ?? "federal",
      name: entry.name ?? family,
      editions: Object.fromEntries(
        Object.entries(entry.editions).map(([abbrev, [start, end]]) => [
          abbrev,
          { start: iso(start), end: iso(end) },
        ]),
      ),
      ...(entry.variations ? { variations: entry.variations } : {}),
    }));
  }
  return out;
}

describe("transform", () => {
  it("flattens families into one record per edition", () => {
    const { editions } = transform(
      upstream({
        "F.": [
          {
            name: "Federal Reporter",
            editions: { "F.": [1880, 1924], "F.2d": [1924, 1993] },
          },
        ],
      }),
    );
    expect(editions.map((e) => e.abbrev)).toEqual(["F.", "F.2d"]);
    expect(editions[0]).toMatchObject({
      name: "Federal Reporter",
      series: "F.",
      start: 1880,
      end: 1924,
    });
  });

  it("takes the year out of an ISO timestamp", () => {
    const { editions } = transform(
      upstream({ X: [{ editions: { X: [1885, null] } }] }),
    );
    expect(editions[0]).toMatchObject({ start: 1885, end: null });
  });

  it.each([
    ["federal", "federal"],
    ["scotus_early", "federal"],
    ["state_regional", "regional"],
    ["state", "state"],
    ["neutral", "state"],
    ["specialty", "specialty"],
    ["specialty_west", "specialty"],
    ["something_new", "specialty"],
  ])("maps cite_type %s to %s", (citeType, expected) => {
    const { editions } = transform(
      upstream({ X: [{ cite_type: citeType, editions: { X: [1900, null] } }] }),
    );
    expect(editions[0]?.jurisdiction).toBe(expected);
  });

  describe("an abbreviation two reporters share", () => {
    const shared = upstream({
      A: [{ name: "First", editions: { "Ark.": [1837, 1861] } }],
      B: [{ name: "Second", editions: { "Ark.": [1900, 1950] } }],
    });

    it("keeps the union of the date spans", () => {
      // The whole point. Picking one — which a plain `Map.set` does — means the
      // year check runs against a reporter the author may not have meant and
      // calls a good citation impossible.
      const { editions } = transform(shared);
      expect(editions).toHaveLength(1);
      expect(editions[0]).toMatchObject({ start: 1837, end: 1950, ambiguous: true });
    });

    it("keeps an open end open", () => {
      const { editions } = transform(
        upstream({
          A: [{ editions: { "Ark.": [1837, 1861] } }],
          B: [{ editions: { "Ark.": [1900, null] } }],
        }),
      );
      expect(editions[0]?.end).toBeNull();
    });

    it("names it after the earlier reporter, deterministically", () => {
      const { editions } = transform(shared);
      expect(editions[0]?.name).toBe("First");
    });

    it("does not flag an abbreviation only one reporter uses", () => {
      const { editions } = transform(
        upstream({ X: [{ editions: { X: [1900, null] } }] }),
      );
      expect(editions[0]?.ambiguous).toBeUndefined();
    });
  });

  it("gives an undated reporter a span that accuses nobody", () => {
    // Four upstream entries have no start date. Inventing one would be
    // inventing the finding.
    const { editions, stats } = transform(
      upstream({ X: [{ editions: { X: [null, null] } }] }),
    );
    expect(stats.undated).toBe(1);
    expect(editions[0]?.start).toBeLessThan(1700);
    expect(editions[0]?.end).toBeNull();
  });

  describe("variations", () => {
    it("keeps a misspelling that points at a real abbreviation", () => {
      const { variations } = transform(
        upstream({
          "F.": [
            { editions: { "F.2d": [1924, 1993] }, variations: { "F. 2d": "F.2d" } },
          ],
        }),
      );
      expect(variations).toEqual({ "F. 2d": "F.2d" });
    });

    it("drops one pointing at an abbreviation that is not in the table", () => {
      // It would suggest a correction to something that does not exist.
      const { variations } = transform(
        upstream({
          X: [{ editions: { X: [1900, null] }, variations: { Y: "NotHere" } }],
        }),
      );
      expect(variations).toEqual({});
    });

    it("drops one that is identical to a real abbreviation", () => {
      const { variations } = transform(
        upstream({
          X: [
            {
              editions: { X: [1900, null], "X.2d": [1950, null] },
              variations: { X: "X.2d" },
            },
          ],
        }),
      );
      expect(variations).toEqual({});
    });

    it("drops one upstream maps to several targets", () => {
      // Ambiguous, so useless for "did you mean".
      const { variations } = transform(
        upstream({
          X: [
            {
              editions: { X: [1900, null], "X.2d": [1950, null] },
              variations: { Y: ["X", "X.2d"] },
            },
          ],
        }),
      );
      expect(variations).toEqual({});
    });
  });

  it("is deterministic", () => {
    const input = upstream({
      "F.": [{ editions: { "F.2d": [1924, 1993], "F.": [1880, 1924] } }],
      "A.": [{ editions: { "A.": [1885, 1938] } }],
    });
    expect(JSON.stringify(transform(input))).toBe(JSON.stringify(transform(input)));
  });
});

describe("the pin", () => {
  const pin = readPin();

  it("names an immutable revision", () => {
    // A tag, not a branch: a branch moves and the digests would be meaningless.
    expect(pin.ref).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("records a digest for every file it lists", () => {
    for (const [path, digest] of Object.entries(pin.files)) {
      expect(digest, `${path} has no digest`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("records the licence and attribution the data is used under", () => {
    expect(pin.license).toBe("BSD-2-Clause");
    expect(pin.copyright).toContain("Free Law Project");
    expect(pin.source).toBe("https://github.com/freelawproject/reporters-db");
  });

  it("matches the revision baked into the generated data", () => {
    // If these drifted, the file would claim a provenance it does not have.
    expect(readGeneratedRevision()).toBe(pin.ref);
  });

  it("builds URLs only on the raw file host", () => {
    expect(rawUrl("v1.0.0", "a/b.json")).toBe(
      "https://raw.githubusercontent.com/freelawproject/reporters-db/v1.0.0/a/b.json",
    );
  });

  it.each(["../../etc/passwd", "main;rm -rf /", "https://evil.example"])(
    "refuses to build a URL from %j",
    (hostile) => {
      expect(() => rawUrl(hostile, "a.json")).toThrow();
    },
  );

  it("hashes deterministically", () => {
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
