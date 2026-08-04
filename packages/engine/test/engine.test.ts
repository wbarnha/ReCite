/** End-to-end behaviour of the check/fix pipeline. */

import { CorpusProvider } from "@recite/core";
import { selectRules } from "@recite/rules";
import { describe, expect, it } from "vitest";

import { countBySeverity, diff, Engine } from "../src/index.js";
import { DEMO_CORPUS, MATA_EXCERPT } from "../../core/test/fixtures/mata-avianca.js";

const engine = () => new Engine({ currentYear: 2026 });

const BRIEF = `El Al Israel Airlines, Ltd. v. Tseng, 525 U.S. 155, 161, 119 S.Ct. 662 (1999).
Delta v. Epsilon, 999 F.3d 1 (2d Cir. 1950).
`;

describe("check", () => {
  it("returns findings in document order", async () => {
    const result = await engine().check(BRIEF);
    const starts = result.diagnostics.map((d) => d.span.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("reports nothing for a clean citation", async () => {
    const result = await engine().check("Ashcroft v. Iqbal, 556 U.S. 662 (2009).");
    expect(result.diagnostics).toEqual([]);
  });

  it("handles an empty document", async () => {
    const result = await engine().check("");
    expect(result.diagnostics).toEqual([]);
    expect(result.extraction.citations).toEqual([]);
  });

  it("keeps every span inside the document", async () => {
    const result = await engine().check(MATA_EXCERPT);
    for (const d of result.diagnostics) {
      expect(d.span.end).toBeLessThanOrEqual(result.text.length);
    }
  });

  it("drops the verification family when no provider is configured", () => {
    expect(engine().activeRules.some((r) => r.requiresVerification)).toBe(false);
  });

  it("counts findings by severity", async () => {
    const result = await engine().check(BRIEF);
    const counts = countBySeverity(result.diagnostics);
    expect(counts.error + counts.warning + counts.info).toBe(result.diagnostics.length);
  });
});

describe("fix", () => {
  it("applies only safe corrections by default", async () => {
    const result = await engine().fix(BRIEF);
    expect(result.applied.every((c) => c.safety === "safe")).toBe(true);
    expect(result.fixedText).toContain("119 S. Ct. 662");
    // The 1950 F.3d citation needs a judgement call, so it is left alone.
    expect(result.fixedText).toContain("999 F.3d 1");
  });

  it("applies substantive corrections on request", async () => {
    const result = await engine().fix(BRIEF, { unsafe: true });
    expect(result.fixedText).toContain("999 F.2d 1");
  });

  it("is idempotent", async () => {
    const once = (await engine().fix(BRIEF)).fixedText;
    const twice = (await engine().fix(once)).fixedText;
    expect(twice).toBe(once);
  });

  it("leaves the surrounding prose untouched", async () => {
    const text = "The court held, in A v. B, 119 S.Ct. 662 (1999), that x.";
    const result = await engine().fix(text);
    expect(result.fixedText).toBe(
      "The court held, in A v. B, 119 S. Ct. 662 (1999), that x.",
    );
  });

  it("returns a clean document unchanged", async () => {
    const result = await engine().fix("Ashcroft v. Iqbal, 556 U.S. 662 (2009).");
    expect(result.changed).toBe(false);
    expect(diff(result)).toBe("");
  });

  it("reduces the number of findings", async () => {
    const before = (await engine().check(BRIEF)).diagnostics.length;
    const fixed = await engine().fix(BRIEF, { unsafe: true });
    const after = (await engine().check(fixed.fixedText)).diagnostics.length;
    expect(after).toBeLessThan(before);
  });

  it("never lets two rules rewrite the same citation", async () => {
    // RP001 wants `999 F.3d 1`; DT001 wants `999 F.2d 1`. Exactly one wins and
    // the loser is reported rather than silently dropped.
    const result = await engine().fix("A v. B, 999 F. 3d 1 (2d Cir. 1950).", {
      unsafe: true,
    });
    expect(result.fixedText.match(/999 F\./g)).toHaveLength(1);
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.[1]).toMatch(/overlaps/);
  });
});

describe("rule selection", () => {
  it("runs only the selected rules", async () => {
    const only = new Engine({
      rules: selectRules({ enable: ["RP001"] }),
      currentYear: 2026,
    });
    const result = await only.check(BRIEF);
    expect(new Set(result.diagnostics.map((d) => d.ruleId))).toEqual(
      new Set(["RP001"]),
    );
  });
});

describe("with a verification provider", () => {
  const withCorpus = () =>
    new Engine({
      provider: new CorpusProvider([...DEMO_CORPUS], "demo"),
      currentYear: 2026,
    });

  it("enables the verification family", () => {
    expect(withCorpus().activeRules.some((r) => r.requiresVerification)).toBe(true);
  });

  it("confirms a citation that is in the corpus", async () => {
    const result = await withCorpus().check("Ashcroft v. Iqbal, 556 U.S. 662 (2009).");
    expect(result.diagnostics.filter((d) => d.ruleId === "VF001")).toEqual([]);
    expect(result.verifications.get(0)?.status).toBe("found");
  });

  it("reports a citation absent from the corpus", async () => {
    const result = await withCorpus().check(
      "Varghese v. China Southern Airlines Co., Ltd., 925 F.3d 1339 (11th Cir. 2019).",
    );
    expect(result.diagnostics.map((d) => d.ruleId)).toContain("VF001");
  });

  it("reports a real citation carrying the wrong case name", async () => {
    const result = await withCorpus().check(
      "Brown v. Board of Education, 556 U.S. 662 (2009).",
    );
    expect(result.diagnostics.map((d) => d.ruleId)).toContain("VF003");
  });

  it("falls back to the offline rules when the provider throws", async () => {
    const broken = new Engine({
      provider: {
        name: "broken",
        verify: () => Promise.reject(new Error("network down")),
      },
      currentYear: 2026,
    });
    const result = await broken.check("A v. B, 119 S.Ct. 662 (1999).");
    expect(result.diagnostics.map((d) => d.ruleId)).toContain("RP001");
    expect(result.diagnostics.some((d) => d.ruleId.startsWith("VF"))).toBe(false);
  });
});

describe("the Mata filing end to end", () => {
  it("finds the defects a format checker can see", async () => {
    const result = await engine().check(MATA_EXCERPT);
    const ids = new Set(result.diagnostics.map((d) => d.ruleId));

    // The reporter is spelled `S.Ct.` in one place and `S. Ct.` in another.
    expect(ids).toContain("RP001");
    expect(ids).toContain("RP003");
    // `2013 IL App (1st) 111279-U` is a non-precedential Rule 23 order.
    expect(ids).toContain("AU001");
    // Two cases are cited by Westlaw number alone.
    expect(ids).toContain("AU002");
    // `App. Div.` names two different states' courts.
    expect(ids).toContain("CT004");
  });

  it("cannot see the fabricated citation without a corpus", async () => {
    const result = await engine().check(MATA_EXCERPT);
    const varghese = result.diagnostics.filter((d) =>
      d.citationText.includes("925 F.3d 1339"),
    );
    // Nothing about its format is wrong. This is the whole argument for
    // verification: the format rules are blind here, by construction.
    expect(varghese).toEqual([]);
  });

  it("sees it once a corpus is supplied", async () => {
    const withCorpus = new Engine({
      provider: new CorpusProvider([...DEMO_CORPUS], "demo"),
      currentYear: 2026,
    });
    const result = await withCorpus.check(MATA_EXCERPT);
    const flagged = result.diagnostics.filter(
      (d) => d.ruleId === "VF001" && d.citationText.includes("925 F.3d 1339"),
    );
    expect(flagged).toHaveLength(1);
  });

  it("safe fixes leave the document's meaning alone", async () => {
    const result = await engine().fix(MATA_EXCERPT);
    // Only spacing changed, so every case name survives untouched.
    for (const name of ["Varghese", "Zicherman", "Kaiser Steel", "Miller"]) {
      expect(result.fixedText).toContain(name);
    }
    expect(result.fixedText).toContain("119 S. Ct. 662");
  });
});
