import { useCallback, useId, useState } from "react";

import type { RichDocument } from "../document/model.js";
import type { DocumentComment, ExportFormat, ReportContext } from "../export/index.js";
import {
  baseName,
  buildExport,
  downloadBlob,
  EXPORT_FORMATS,
  isReport,
} from "../export/index.js";

/** Formats with a real comment feature to write a note into. */
function carriesComments(format: ExportFormat): boolean {
  return format.id === "docx" || format.id === "odt";
}

/**
 * Save the document, or the findings, in a chosen format.
 *
 * Built in the page and handed straight to the browser — there is no upload
 * and no round trip, exactly as when reading a file.
 */
export function SaveAs({
  text,
  context,
  comments = [],
  document,
  disabled = false,
}: {
  text: string;
  context: ReportContext;
  /** Pincite notes to write into the file, for the formats that carry one. */
  comments?: readonly DocumentComment[];
  /**
   * The formatted document, read at the moment of saving.
   *
   * A getter rather than a value: the editor owns its own DOM and does not
   * re-render this component when a word is typed, so anything captured here
   * on the last render would be a document from several keystrokes ago.
   */
  document?: () => RichDocument | undefined;
  disabled?: boolean;
}) {
  const selectId = useId();
  const [formatId, setFormatId] = useState(EXPORT_FORMATS[0]!.id);
  const [error, setError] = useState("");

  const format: ExportFormat =
    EXPORT_FORMATS.find((candidate) => candidate.id === formatId) ?? EXPORT_FORMATS[0]!;

  const save = useCallback(async () => {
    setError("");
    try {
      const rich = document?.();
      const blob = await buildExport(format, text, context, {
        comments,
        ...(rich ? { document: rich } : {}),
      });
      const suffix = isReport(format) ? "-citation-report" : "-checked";
      downloadBlob(
        blob,
        `${baseName(context.documentName)}${suffix}${format.extension}`,
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }, [format, text, context, comments, document]);

  const empty = text.trim().length === 0;
  const noFindings = isReport(format) && context.findings.length === 0;

  return (
    <div className="saveas">
      <label htmlFor={selectId} className="saveas-label">
        Save as
      </label>
      <select
        id={selectId}
        value={formatId}
        disabled={disabled}
        onChange={(event) => setFormatId(event.target.value)}
      >
        <optgroup label="Document">
          {EXPORT_FORMATS.filter((candidate) => !isReport(candidate)).map(
            (candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label} ({candidate.extension})
              </option>
            ),
          )}
        </optgroup>
        <optgroup label="Findings report">
          {EXPORT_FORMATS.filter(isReport).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </optgroup>
      </select>
      <button type="button" onClick={() => void save()} disabled={disabled || empty}>
        Download
      </button>
      <p className="saveas-note">
        {format.note}
        {noFindings && " Nothing has been checked yet, so the report will be empty."}
        {comments.length > 0 && !carriesComments(format) && !isReport(format) && (
          <>
            {" "}
            <strong>
              This format has no notion of a comment, so the {comments.length} pincite{" "}
              {comments.length === 1 ? "note" : "notes"} will not be in it.
            </strong>{" "}
            Choose Word or OpenDocument to keep them.
          </>
        )}
      </p>
      {error && (
        <p className="filedrop-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
