/**
 * Telling us a citation was judged wrongly.
 *
 * ReCite is a linter, and a linter's worst failure is not being wrong once —
 * it is being wrong in a way nobody tells you about. A lawyer who sees
 * `RP001` fire on a citation they know is correct will do the rational thing
 * and stop reading `RP001`, and every real finding it makes afterwards is
 * wasted. So the report has to be one click from the finding, and it has to
 * arrive containing what a fix actually needs.
 *
 * Three constraints shape everything here.
 *
 * **There is nowhere to send it.** No server, no telemetry, no endpoint. This
 * module *composes* a report; delivering it is the reporter's own act — copy
 * it, save it, or open a prefilled issue — and `deliver.ts` is the whole of
 * that.
 *
 * **The tracker is public.** A report carries a citation out of a document
 * that may be privileged. So it carries the citation and nothing else unless
 * the reporter asks for more, the surrounding sentence is bounded and opt-in,
 * and the exact text is shown before anything leaves the page. `support.html`
 * has always told people not to paste client text into an issue; composing the
 * report for them is how that advice stops depending on their care.
 *
 * **A report without the settings is unactionable.** The same citation is a
 * finding under the Whitepages and clean under the 21st Bluepages, and
 * `VF001` means something different against five sample cases than against
 * CourtListener. A report that omits those costs a round trip to establish
 * what was actually run.
 */

import type { Diagnostic, Span } from "@recite/core";

/** What kind of mistake is being reported. */
export type ReportKind =
  /** ReCite reported a problem, and the citation is correct as written. */
  | "false-positive"
  /** The citation is wrong and ReCite said nothing. */
  | "missed"
  /** ReCite was right that something is wrong, and its fix is not the fix. */
  | "wrong-fix";

export const REPORT_KINDS: readonly ReportKind[] = [
  "false-positive",
  "missed",
  "wrong-fix",
];

export const KIND_LABEL: Record<ReportKind, string> = {
  "false-positive": "This citation is correct — ReCite should not have flagged it",
  missed: "This citation is wrong — ReCite did not catch it",
  "wrong-fix": "The problem is real, but the suggested fix is wrong",
};

/** How the title of an issue opens, so a maintainer can triage from the list. */
const KIND_TITLE: Record<ReportKind, string> = {
  "false-positive": "False positive",
  missed: "Missed",
  "wrong-fix": "Wrong fix",
};

export interface ReportSubject {
  readonly kind: ReportKind;
  /** The citation exactly as it appears in the document. */
  readonly citation: string;
  /** The sentence around it — present only when the reporter opted in. */
  readonly context?: string;
  readonly ruleId?: string;
  readonly ruleMessage?: string;
  /** What ReCite proposed to write instead, for a `wrong-fix` report. */
  readonly suggestion?: string;
  /** What the reporter says should have happened. Free text, theirs. */
  readonly expected?: string;
}

export interface ReportEnvironment {
  /** `describeProfile(...)` — which Bluebook was being checked against. */
  readonly profile: string;
  /** What "does this case exist" was answered against, if anything. */
  readonly authority: string;
  readonly version: string;
  readonly commit: string;
  readonly reporterData: string;
  /** What the document was read from, when it came from a file. */
  readonly format?: string;
  /**
   * Whether any of the text came from optical character recognition.
   *
   * The single most useful thing in a report, and the reason it is near the
   * top of one. OCR misreads `1` for `l` and `5` for `S`, which are the
   * characters citations are made of — so on a scanned document the likeliest
   * explanation of a wrong finding is that the citation ReCite checked is not
   * the citation on the page. Saying so up front saves a round trip on most
   * reports and stops a reader chasing a rule bug that is not there.
   */
  readonly ocrPages?: number;
}

// ------------------------------------------------------------------ context --

/** The most surrounding text a report will ever carry. */
export const MAX_CONTEXT = 240;

/**
 * The sentence a citation sits in, bounded.
 *
 * Bounded twice over, and both bounds matter: {@link MAX_CONTEXT} caps it
 * whatever the punctuation does, and the window is clipped to the nearest
 * sentence break inside that cap. A report is meant to carry a citation out of
 * somebody's brief, not a paragraph of it, and "it took the sentence" is a
 * promise a reader can check against what the preview shows them.
 *
 * Some rules genuinely need it — `ST001` is about a short form having nothing
 * to point back to, and `RP003` about two spellings in one document — which is
 * why it exists at all rather than being refused outright.
 */
export function contextAround(
  text: string,
  span: Span,
  maxChars: number = MAX_CONTEXT,
): string {
  const half = Math.floor(Math.max(0, maxChars - (span.end - span.start)) / 2);
  const from = Math.max(0, span.start - half);
  const to = Math.min(text.length, span.end + half);

  const before = text.slice(from, span.start);
  const after = text.slice(span.end, to);

  // Clip to a sentence boundary *inside* the window, so the trim can only ever
  // make the excerpt smaller.
  //
  // The two lookbehinds are the part that earns its keep. Legal prose is made
  // of abbreviations, and both of the commonest ones look exactly like the end
  // of a sentence: the stop in `526 U.S. 795`, and the one in `Doe v. Roe`.
  // Without them the excerpt around a court parenthetical began mid-citation,
  // at `795 (U.S. 1999)`, which tells a maintainer nothing.
  //
  // A capital letter before the stop catches the first; a lone letter at a
  // word boundary catches the second. Each costs the occasional genuine
  // sentence break, which only makes the excerpt *longer* — and the cap, not
  // the punctuation, is what actually bounds this.
  const boundary = String.raw`(?<![A-Z])(?<!\b[A-Za-z])[.?!]["”’)]?`;

  const opened = new RegExp(`${boundary}\\s+(?=[A-Z“"(])`, "g");
  let leading = 0;
  for (const match of before.matchAll(opened)) leading = match.index + match[0].length;

  const closed = new RegExp(`${boundary}(?:\\s|$)`).exec(after);
  const trailing = closed ? closed.index + closed[0].trimEnd().length : after.length;

  const excerpt =
    before.slice(leading) + text.slice(span.start, span.end) + after.slice(0, trailing);

  return excerpt.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/**
 * A report prefilled from a finding.
 *
 * The kind starts at `false-positive` because that is what someone reporting a
 * finding almost always means — they are looking at a citation they believe is
 * correct. The dialog lets them say otherwise; this only saves the common case
 * a click.
 */
export function subjectFor(
  diagnostic: Diagnostic,
  text: string,
  withContext: boolean,
): ReportSubject {
  return {
    kind: "false-positive",
    citation: diagnostic.citationText,
    ruleId: diagnostic.ruleId,
    ruleMessage: diagnostic.message,
    ...(diagnostic.correction ? { suggestion: diagnostic.correction.replacement } : {}),
    ...(withContext ? { context: contextAround(text, diagnostic.span) } : {}),
  };
}

// ------------------------------------------------------------------- render --

export function reportTitle(subject: ReportSubject): string {
  const rule = subject.ruleId ? ` ${subject.ruleId}` : "";
  const citation = subject.citation.replace(/\s+/g, " ").trim();
  const shown = citation.length > 60 ? `${citation.slice(0, 57)}…` : citation;
  return `${KIND_TITLE[subject.kind]}${rule}: ${shown || "(no citation given)"}`;
}

/**
 * The report, as Markdown.
 *
 * Written to be read by whoever picks the issue up, in the order they need it:
 * the caveat that might explain the whole thing, then what happened, then what
 * was expected, then the settings that decide whether it should have.
 */
export function reportMarkdown(
  subject: ReportSubject,
  environment: ReportEnvironment,
): string {
  const lines: string[] = [];

  if (environment.ocrPages !== undefined) {
    lines.push(
      "> **Read by OCR.** " +
        (environment.ocrPages > 0
          ? `${environment.ocrPages} page${environment.ocrPages === 1 ? "" : "s"} of this document were recognised from images, `
          : "Part of this document was recognised from images, ") +
        "so the citation below may not be the citation on the page. Optical " +
        "character recognition confuses `1` for `l` and `5` for `S`, which are " +
        "the characters citations are made of.",
      "",
    );
  }

  lines.push(`**What happened:** ${KIND_LABEL[subject.kind]}`, "");

  lines.push("**The citation, as written:**", "", "```", subject.citation, "```", "");

  if (subject.ruleId) {
    lines.push(
      `**Rule:** \`${subject.ruleId}\``,
      "",
      `> ${(subject.ruleMessage ?? "").replace(/\n/g, " ")}`,
      "",
    );
  } else {
    lines.push("**Rule:** none — nothing was reported for this citation.", "");
  }

  if (subject.suggestion !== undefined) {
    lines.push("**ReCite suggested:**", "", "```", subject.suggestion, "```", "");
  }

  lines.push(
    "**What it should have done:**",
    "",
    subject.expected?.trim() || "_(not said)_",
    "",
  );

  if (subject.context) {
    lines.push(
      "**Surrounding text**, included by the reporter:",
      "",
      "```",
      subject.context,
      "```",
      "",
    );
  }

  lines.push(
    "---",
    "",
    "| | |",
    "| --- | --- |",
    `| Bluebook | ${environment.profile} |`,
    `| Authority check | ${environment.authority} |`,
    ...(environment.format ? [`| Read as | ${environment.format} |`] : []),
    `| ReCite | ${environment.version} (\`${environment.commit}\`) |`,
    `| Reporter data | freelawproject/reporters-db ${environment.reporterData} |`,
    "",
    "_Composed by ReCite in the browser. Nothing was transmitted in preparing_",
    "_it, and the reporter chose what it contains._",
    "",
  );

  return lines.join("\n");
}

// --------------------------------------------------------------------- link --

/**
 * Past this, a prefilled issue link stops working.
 *
 * Servers and proxies cap a request line long before the standard says they
 * must, and a link that silently truncated would hand a maintainer half a
 * report. When the body is too long the link is refused and the reporter is
 * told to copy it instead — which sends nothing anywhere and always works.
 */
export const MAX_ISSUE_URL = 6000;

export interface IssueLink {
  readonly url?: string;
  /** Why there is no link, when there is none. */
  readonly reason?: string;
}

export function issueLink(
  repoUrl: string,
  subject: ReportSubject,
  environment: ReportEnvironment,
): IssueLink {
  if (!/^https:\/\/github\.com\//.test(repoUrl)) {
    return { reason: "this build does not know where its source lives" };
  }

  const url =
    `${repoUrl.replace(/\/+$/, "")}/issues/new` +
    `?title=${encodeURIComponent(reportTitle(subject))}` +
    `&body=${encodeURIComponent(reportMarkdown(subject, environment))}` +
    `&labels=${encodeURIComponent("citation report")}`;

  if (url.length > MAX_ISSUE_URL) {
    return {
      reason:
        "this report is too long to carry in a link — copy it and paste it into " +
        "a new issue instead",
    };
  }
  return { url };
}
