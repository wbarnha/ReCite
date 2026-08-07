/**
 * Reporting a citation ReCite judged wrongly.
 *
 * Two things are worth failing a build over, and they pull against each other.
 *
 * **A report has to be actionable.** The same citation is a finding under the
 * Whitepages and clean under the 21st Bluepages, and `VF001` means one thing
 * against five sample cases and another against CourtListener. A report that
 * omits the settings costs a round trip before anyone can even reproduce it.
 *
 * **A report must not carry the document.** It leaves for a public tracker,
 * out of a brief that may be privileged. So the excerpt is bounded, and
 * bounded is a property that can be tested rather than remembered.
 */

import type { Diagnostic } from "@recite/core";
import { describe, expect, it } from "vitest";

import {
  contextAround,
  issueLink,
  KIND_LABEL,
  MAX_CONTEXT,
  MAX_ISSUE_URL,
  reportMarkdown,
  reportTitle,
  subjectFor,
  type ReportEnvironment,
  type ReportSubject,
} from "../src/feedback/report.js";

const ENVIRONMENT: ReportEnvironment = {
  profile: "Bluebook 21st edition, Bluepages (court documents)",
  authority: "CourtListener, the Free Law Project's collection",
  version: "1.0.0.0",
  commit: "abc123def456",
  reporterData: "v3.2.66",
};

const SUBJECT: ReportSubject = {
  kind: "false-positive",
  citation: "119 S.Ct. 662",
  ruleId: "RP001",
  ruleMessage: 'Reporter "S.Ct." is closed up.',
  expected: "The 21st edition Bluepages permit this.",
};

const diagnostic = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  ruleId: "RP001",
  severity: "warning",
  message: 'Reporter "S.Ct." is closed up.',
  span: { start: 10, end: 23 },
  citationText: "119 S.Ct. 662",
  ...over,
});

describe("the excerpt around a citation", () => {
  const brief = [
    "PRIVILEGED AND CONFIDENTIAL. Do not circulate this draft.",
    "The Court held otherwise in Tseng, 119 S.Ct. 662 (1999).",
    "Counsel's strategy for the hearing is set out in the appendix.",
  ].join(" ");

  const span = {
    start: brief.indexOf("119 S.Ct. 662"),
    end: brief.indexOf("119 S.Ct. 662") + "119 S.Ct. 662".length,
  };

  it("takes the sentence the citation sits in", () => {
    expect(contextAround(brief, span)).toBe(
      "The Court held otherwise in Tseng, 119 S.Ct. 662 (1999).",
    );
  });

  it("does not reach into the sentences either side of it", () => {
    // The whole point. A report leaves for a public tracker, and the
    // paragraphs around a citation are somebody's draft.
    const excerpt = contextAround(brief, span);
    expect(excerpt).not.toContain("PRIVILEGED");
    expect(excerpt).not.toContain("strategy");
  });

  it("is bounded even when the document has no punctuation at all", () => {
    // A sentence boundary is a heuristic; the cap is not.
    const unbroken = `${"word ".repeat(400)}119 S.Ct. 662 ${"word ".repeat(400)}`;
    const at = unbroken.indexOf("119 S.Ct. 662");
    const excerpt = contextAround(unbroken, {
      start: at,
      end: at + "119 S.Ct. 662".length,
    });

    expect(excerpt.length).toBeLessThanOrEqual(MAX_CONTEXT);
    expect(excerpt).toContain("119 S.Ct. 662");
  });

  it("honours a tighter cap when it is given one", () => {
    expect(contextAround(brief, span, 40).length).toBeLessThanOrEqual(40);
  });

  it("copes with a citation at the very start or end of a document", () => {
    expect(contextAround("119 S.Ct. 662", { start: 0, end: 13 })).toBe("119 S.Ct. 662");
    const trailing = "See generally 119 S.Ct. 662";
    expect(contextAround(trailing, { start: 14, end: 27 })).toBe(trailing);
  });

  it("is not fooled by the abbreviations legal prose is made of", () => {
    // The full stop in `526 U.S. 795` looks exactly like the end of a
    // sentence. Reading it as one cut the excerpt to `795 (U.S. 1999).` —
    // which starts mid-citation and tells a maintainer nothing.
    const text =
      "An earlier point. The Court held otherwise in Doe v. Roe, 526 U.S. 795 " +
      "(U.S. 1999). A later point.";
    const at = text.indexOf("(U.S.");

    expect(contextAround(text, { start: at, end: at + 5 })).toBe(
      "The Court held otherwise in Doe v. Roe, 526 U.S. 795 (U.S. 1999).",
    );
  });

  it("flattens the newlines a document is full of", () => {
    const wrapped = "See\nTseng,\n119 S.Ct. 662\n(1999).";
    expect(contextAround(wrapped, { start: 11, end: 24 })).toBe(
      "See Tseng, 119 S.Ct. 662 (1999).",
    );
  });
});

describe("prefilling from a finding", () => {
  it("carries the rule, the message and the citation", () => {
    const subject = subjectFor(diagnostic(), "x".repeat(40), false);
    expect(subject).toMatchObject({
      kind: "false-positive",
      ruleId: "RP001",
      citation: "119 S.Ct. 662",
    });
  });

  it("carries the suggested fix, so a wrong one can be reported", () => {
    const subject = subjectFor(
      diagnostic({
        correction: {
          span: { start: 10, end: 23 },
          replacement: "119 S. Ct. 662",
          safety: "safe",
          description: "space the reporter",
        },
      }),
      "x".repeat(40),
      false,
    );
    expect(subject.suggestion).toBe("119 S. Ct. 662");
  });

  it("includes the surrounding sentence only when asked", () => {
    const text = "A sentence. The Court held otherwise. Another sentence.";
    expect(subjectFor(diagnostic(), text, false).context).toBeUndefined();
    expect(subjectFor(diagnostic(), text, true).context).toBeDefined();
  });
});

describe("the report itself", () => {
  const markdown = reportMarkdown(SUBJECT, ENVIRONMENT);

  it("says what happened, in the reporter's words and the rule's", () => {
    expect(markdown).toContain(KIND_LABEL["false-positive"]);
    expect(markdown).toContain("119 S.Ct. 662");
    expect(markdown).toContain("RP001");
    expect(markdown).toContain("The 21st edition Bluepages permit this.");
  });

  it("records the settings, without which it cannot be reproduced", () => {
    // The same citation is a finding under one Bluebook and clean under
    // another; `VF001` means different things against different sources.
    expect(markdown).toContain("Bluebook 21st edition");
    expect(markdown).toContain("CourtListener");
    expect(markdown).toContain("abc123def456");
    expect(markdown).toContain("v3.2.66");
  });

  it("says when nothing was reported, rather than leaving the rule blank", () => {
    const missed = reportMarkdown(
      { kind: "missed", citation: "925 F.3d 1339" },
      ENVIRONMENT,
    );
    expect(missed).toContain("none — nothing was reported");
  });

  it("admits when the reporter did not say what they expected", () => {
    const bare = reportMarkdown({ ...SUBJECT, expected: "  " }, ENVIRONMENT);
    expect(bare).toContain("_(not said)_");
  });

  it("carries no surrounding text unless the subject has some", () => {
    expect(markdown).not.toContain("Surrounding text");
    expect(
      reportMarkdown({ ...SUBJECT, context: "A sentence." }, ENVIRONMENT),
    ).toContain("Surrounding text");
  });

  it("leads with the OCR caveat, because it explains most reports", () => {
    // On a scan the likeliest explanation of a wrong finding is that the
    // citation ReCite checked is not the citation on the page. Saying so
    // before anything else saves a round trip.
    const scanned = reportMarkdown(SUBJECT, { ...ENVIRONMENT, ocrPages: 4 });
    expect(scanned.split("\n")[0]).toMatch(/Read by OCR/);
    expect(scanned).toContain("4 pages");
    expect(scanned).not.toContain("4 page ");
  });

  it("still says so when the page count is not known", () => {
    const scanned = reportMarkdown(SUBJECT, { ...ENVIRONMENT, ocrPages: 0 });
    expect(scanned).toMatch(/Part of this document was recognised/);
  });

  it("says plainly that nothing was transmitted to compose it", () => {
    expect(markdown).toContain("Nothing was transmitted");
  });
});

describe("the title", () => {
  it("names the kind, the rule and the citation, for triage from a list", () => {
    expect(reportTitle(SUBJECT)).toBe("False positive RP001: 119 S.Ct. 662");
  });

  it("shortens a citation rather than filling the list with one title", () => {
    const long = reportTitle({ ...SUBJECT, citation: "x".repeat(200) });
    expect(long.length).toBeLessThan(90);
    expect(long).toMatch(/…$/);
  });

  it("has something to say even when the citation field is empty", () => {
    expect(reportTitle({ kind: "missed", citation: "" })).toContain("no citation");
  });
});

describe("the prefilled issue link", () => {
  const REPO = "https://github.com/wbarnha/ReCite";

  it("points at this build's own repository", () => {
    // Baked in from `GITHUB_REPOSITORY`, so a fork files against the fork.
    const { url } = issueLink(REPO, SUBJECT, ENVIRONMENT);
    expect(url).toMatch(/^https:\/\/github\.com\/wbarnha\/ReCite\/issues\/new\?/);
  });

  it("carries the report, and nothing the report does not have", () => {
    const { url } = issueLink(REPO, SUBJECT, ENVIRONMENT);
    const body = new URL(url!).searchParams.get("body") ?? "";
    expect(body).toBe(reportMarkdown(SUBJECT, ENVIRONMENT));
  });

  it("escapes a citation rather than letting it forge a parameter", () => {
    const injected: ReportSubject = {
      kind: "missed",
      citation: "1 U.S. 1&labels=security&body=surprise",
    };
    const { url } = issueLink(REPO, injected, ENVIRONMENT);
    const params = new URL(url!).searchParams;
    expect(params.getAll("labels")).toEqual(["citation report"]);
    expect(params.get("title")).toContain("&labels=security");
  });

  it("refuses a link too long to survive the trip, and says why", () => {
    // A truncated link would hand a maintainer half a report. Copying it
    // sends nothing anywhere and always works.
    const huge = { ...SUBJECT, expected: "y".repeat(MAX_ISSUE_URL) };
    const link = issueLink(REPO, huge, ENVIRONMENT);
    expect(link.url).toBeUndefined();
    expect(link.reason).toMatch(/too long/);
  });

  it("refuses a repository URL that is not GitHub", () => {
    // The prefill syntax is GitHub's. Somewhere else would produce a link
    // that opens a page with the report silently dropped.
    expect(issueLink("https://example.invalid/x", SUBJECT, ENVIRONMENT).url).toBe(
      undefined,
    );
    expect(issueLink("", SUBJECT, ENVIRONMENT).reason).toMatch(/where its source/);
  });
});
