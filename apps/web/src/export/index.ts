/**
 * Saving the document back out, in whichever format the user asks for.
 *
 * Everything is built in the page and handed to the browser as a `Blob`. There
 * is no upload and no round trip — the same guarantee that governs reading a
 * file governs writing one, and for the same reason.
 *
 * The list mirrors what ReCite can read, because a tool that opens a `.docx`
 * and can only give back a `.txt` has quietly lost the user's format.
 */

import { writeDocx, writeOdt } from "./office.js";
import { writePdf } from "./pdf.js";

export interface ExportFormat {
  readonly id: string;
  readonly label: string;
  readonly extension: string;
  readonly mime: string;
  /** What it is good for, shown next to the choice. */
  readonly note: string;
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: "txt",
    label: "Plain text",
    extension: ".txt",
    mime: "text/plain;charset=utf-8",
    note: "Exactly the characters, nothing else.",
  },
  {
    id: "md",
    label: "Markdown",
    extension: ".md",
    mime: "text/markdown;charset=utf-8",
    note: "Plain text by another name.",
  },
  {
    id: "docx",
    label: "Word document",
    extension: ".docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    note: "Opens in Word. Text only — ReCite never had your formatting.",
  },
  {
    id: "odt",
    label: "OpenDocument text",
    extension: ".odt",
    mime: "application/vnd.oasis.opendocument.text",
    note: "Opens in LibreOffice. Text only.",
  },
  {
    id: "rtf",
    label: "Rich Text Format",
    extension: ".rtf",
    mime: "application/rtf",
    note: "Opens almost anywhere.",
  },
  {
    id: "html",
    label: "HTML",
    extension: ".html",
    mime: "text/html;charset=utf-8",
    note: "For the web, or for printing from a browser.",
  },
  {
    id: "pdf",
    label: "PDF",
    extension: ".pdf",
    mime: "application/pdf",
    note: "Fixed layout, Helvetica. Not a copy of any PDF you opened.",
  },
  {
    id: "report.json",
    label: "Findings report (JSON)",
    extension: ".json",
    mime: "application/json",
    note: "Every finding, with rule ids and offsets, for another tool to read.",
  },
  {
    id: "report.csv",
    label: "Findings report (CSV)",
    extension: ".csv",
    mime: "text/csv;charset=utf-8",
    note: "One row per finding, for a spreadsheet.",
  },
  {
    id: "report.md",
    label: "Findings report (Markdown)",
    extension: ".md",
    mime: "text/markdown;charset=utf-8",
    note: "A readable summary to paste into a memo.",
  },
];

/** A finding, in the shape the report writers need. */
export interface ReportFinding {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly severity: string;
  readonly message: string;
  readonly citation: string;
  readonly start: number;
  readonly end: number;
  readonly suggestion?: string;
}

export interface ReportContext {
  readonly documentName: string;
  readonly profile: string;
  readonly citationCount: number;
  readonly findings: readonly ReportFinding[];
  /** Build identity, so a report can be tied to the version that produced it. */
  readonly version: string;
  readonly commit: string;
  /**
   * Which revision of the reporter table the findings were made against.
   *
   * A date-range finding is only as good as the data behind it, and that data
   * comes from a specific upstream release. Recording it means a report can be
   * re-examined later against the same table rather than whatever is current.
   */
  readonly reporterData: string;
}

// ------------------------------------------------------------- documents ---

/** Escape for HTML text content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toHtml(text: string, title: string): string {
  // Joined with nothing, and a blank line is an empty `<p>` rather than one
  // holding `&nbsp;`. Both matter for the round trip: whitespace between
  // block elements is content to an HTML reader, so newlines here turned
  // every paragraph gap into a blank line, and an `&nbsp;` inside an
  // otherwise-empty paragraph came back as a line with a space in it. The CSS
  // margin gives the gap its height, so it still looks right in a browser.
  const body = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 44rem; margin: 3rem auto; padding: 0 1.25rem;
         font: 16px/1.7 Georgia, "Times New Roman", serif; }
  p { margin: 0 0 0.9rem; min-height: 1em; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/**
 * Write RTF.
 *
 * The inverse of the reader, and it has to handle the same characters: a
 * section sign or an en dash written raw into an ANSI RTF is mojibake in Word,
 * so anything outside ASCII becomes a `\uN` escape with a `?` fallback.
 */
function toRtf(text: string): string {
  let body = "";
  for (const ch of text.replace(/\r\n?/g, "\n")) {
    if (ch === "\n") {
      body += "\\par\n";
    } else if (ch === "\\" || ch === "{" || ch === "}") {
      body += `\\${ch}`;
    } else if (ch === "\t") {
      body += "\\tab ";
    } else {
      const code = ch.codePointAt(0) ?? 0;
      // `\uN?` — the number, then one replacement character for readers that
      // cannot show it. `\uc1` above declares that fallback is one character.
      body += code < 128 ? ch : `\\u${code > 32767 ? code - 65536 : code}?`;
    }
  }

  return `{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}}\n\\f0\\fs22 ${body}}`;
}

// --------------------------------------------------------------- reports ---

function reportJson(context: ReportContext): string {
  return `${JSON.stringify(
    {
      tool: "ReCite",
      version: context.version,
      commit: context.commit,
      reporterData: context.reporterData,
      document: context.documentName,
      bluebook: context.profile,
      citations: context.citationCount,
      findings: context.findings,
    },
    null,
    2,
  )}\n`;
}

/** Quote a CSV field, per RFC 4180. */
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function reportCsv(context: ReportContext): string {
  const rows = [
    ["rule", "name", "severity", "citation", "start", "end", "message", "suggestion"],
    ...context.findings.map((finding) => [
      finding.ruleId,
      finding.ruleName,
      finding.severity,
      finding.citation,
      String(finding.start),
      String(finding.end),
      finding.message,
      finding.suggestion ?? "",
    ]),
  ];
  return `${rows.map((row) => row.map(csvField).join(",")).join("\n")}\n`;
}

function reportMarkdown(context: ReportContext): string {
  const lines = [
    `# Citation check — ${context.documentName}`,
    "",
    `- **Checked against:** ${context.profile}`,
    `- **Citations found:** ${context.citationCount}`,
    `- **Findings:** ${context.findings.length}`,
    `- **ReCite:** ${context.version} (commit ${context.commit})`,
    `- **Reporter data:** freelawproject/reporters-db ${context.reporterData}`,
    "",
  ];

  if (context.findings.length === 0) {
    lines.push(
      "No findings. Note that this is not a verification: ReCite proves that",
      "specific things are wrong, and cannot prove a citation is right.",
      "",
    );
  } else {
    lines.push("| Rule | Severity | Citation | Problem |", "| --- | --- | --- | --- |");
    for (const finding of context.findings) {
      const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(
        `| \`${finding.ruleId}\` | ${finding.severity} | ${cell(finding.citation)} | ${cell(finding.message)} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

// ----------------------------------------------------------------- write ---

export function isReport(format: ExportFormat): boolean {
  return format.id.startsWith("report.");
}

/** Build the bytes for one format. */
export async function buildExport(
  format: ExportFormat,
  text: string,
  context: ReportContext,
): Promise<Blob> {
  switch (format.id) {
    case "docx":
      return writeDocx(text);
    case "odt":
      return writeOdt(text);
    case "pdf":
      return writePdf(text);
    case "rtf":
      return new Blob([toRtf(text)], { type: format.mime });
    case "html":
      return new Blob([toHtml(text, context.documentName)], { type: format.mime });
    case "report.json":
      return new Blob([reportJson(context)], { type: format.mime });
    case "report.csv":
      return new Blob([reportCsv(context)], { type: format.mime });
    case "report.md":
      return new Blob([reportMarkdown(context)], { type: format.mime });
    default:
      return new Blob([text], { type: format.mime });
  }
}

/** Strip any extension and anything a filesystem would object to. */
export function baseName(name: string): string {
  const withoutExtension = name.replace(/\.[^./\\]+$/, "");
  const cleaned = withoutExtension.replace(/[/\\:*?"<>|]+/g, "-").trim();
  return cleaned || "document";
}

/**
 * Hand a blob to the browser as a download.
 *
 * An object URL and a synthetic click: no server, no round trip. The URL is
 * revoked afterwards so the blob does not stay resident — a checked brief can
 * be several megabytes and there is no reason to keep it alive.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A timeout rather than an immediate revoke: some browsers have not started
  // reading the blob by the time `click()` returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
