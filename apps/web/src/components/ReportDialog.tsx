import { useCallback, useEffect, useId, useRef, useState } from "react";

import { copyReport, openIssue, saveReport } from "../feedback/deliver.js";
import type {
  ReportEnvironment,
  ReportKind,
  ReportSubject,
} from "../feedback/report.js";
import {
  issueLink,
  KIND_LABEL,
  REPORT_KINDS,
  reportMarkdown,
  reportTitle,
} from "../feedback/report.js";

export interface ReportDialogProps {
  /** The finding or citation being reported, prefilled. */
  readonly subject: ReportSubject;
  readonly environment: ReportEnvironment;
  /** Where the source lives, so a fork files against the fork. */
  readonly repoUrl: string;
  readonly onClose: () => void;
}

/**
 * Report a citation ReCite judged wrongly.
 *
 * A linter's worst failure is not being wrong once — it is being wrong in a
 * way nobody tells you about. Someone who sees a rule fire on a citation they
 * know is correct will rationally stop reading that rule, and every real
 * finding it makes afterwards is wasted. So reporting is one click from the
 * finding.
 *
 * Everything in here is arranged around one problem: **the tracker is public
 * and the document may be privileged.** Hence the shape.
 *
 * - The citation is an editable field, not a fixed string. A reporter who
 *   needs to change a party name before sending can.
 * - The surrounding sentence is opt-in, bounded, and counted in the label.
 * - The preview is the actual text, not a summary of it. Nothing goes that
 *   was not read first.
 * - **Copy** is the default action and involves no network. Opening an issue
 *   is offered last and says that it leaves the page.
 *
 * Mounted only while it is open, which is what makes the fields start out
 * right. Keeping it mounted and syncing from `subject` in an effect painted
 * one frame with the previous report's answers in it — and a dialog that
 * flashes somebody else's citation is not a dialog anyone should trust with
 * this.
 */
export function ReportDialog({
  subject,
  environment,
  repoUrl,
  onClose,
}: ReportDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const kindId = useId();
  const citationId = useId();
  const expectedId = useId();
  const previewId = useId();

  const [kind, setKind] = useState<ReportKind>(subject.kind);
  const [citation, setCitation] = useState(subject.citation);
  const [expected, setExpected] = useState(subject.expected ?? "");
  const [withContext, setWithContext] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  /**
   * The report, built field by field rather than spread from `subject`.
   *
   * Deliberately not `{ ...subject, ... }`. A spread would carry `context`
   * through whatever the tick-box said, which is exactly how a piece of
   * somebody's document ends up in a public issue nobody agreed to send. When
   * the field in question is an excerpt of a brief, explicit beats convenient.
   */
  const composed: ReportSubject = {
    kind,
    citation,
    expected,
    ...(subject.ruleId ? { ruleId: subject.ruleId } : {}),
    ...(subject.ruleMessage ? { ruleMessage: subject.ruleMessage } : {}),
    ...(subject.suggestion !== undefined ? { suggestion: subject.suggestion } : {}),
    ...(withContext && subject.context ? { context: subject.context } : {}),
  };

  const markdown = reportMarkdown(composed, environment);
  const link = issueLink(repoUrl, composed, environment);

  const copy = useCallback(async () => {
    setStatus(
      (await copyReport(markdown))
        ? "Copied. Paste it into an issue, an email, or your own tracker."
        : "This browser would not let ReCite use the clipboard — select the " +
            "preview and copy it by hand.",
    );
  }, [markdown]);

  return (
    <dialog
      ref={dialog}
      className="report"
      aria-label="Report a citation ReCite got wrong"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2>Report a citation ReCite got wrong</h2>

      <div className="notice report-warning">
        <p>
          <strong>Nothing has been sent, and nothing will be without you.</strong>{" "}
          ReCite has no server. This composes the report; you decide where it goes.
        </p>
        <p>
          The issue tracker is <strong>public</strong>. What you send is what the
          preview shows — the citation below and nothing else, unless you tick the box.
          Edit the citation first if it needs it.
        </p>
      </div>

      <label htmlFor={kindId}>What went wrong</label>
      <select
        id={kindId}
        value={kind}
        onChange={(event) => setKind(event.target.value as ReportKind)}
      >
        {REPORT_KINDS.filter(
          // Nothing was suggested, so there is no wrong fix to report.
          (candidate) => candidate !== "wrong-fix" || subject.suggestion !== undefined,
        ).map((candidate) => (
          <option key={candidate} value={candidate}>
            {KIND_LABEL[candidate]}
          </option>
        ))}
      </select>

      <label htmlFor={citationId}>The citation, as it appears</label>
      <input
        id={citationId}
        type="text"
        value={citation}
        spellCheck={false}
        onChange={(event) => setCitation(event.target.value)}
      />

      <label htmlFor={expectedId}>What should it have done?</label>
      <textarea
        id={expectedId}
        rows={3}
        value={expected}
        placeholder="e.g. this is the correct spacing under the 21st edition Bluepages"
        onChange={(event) => setExpected(event.target.value)}
      />

      {subject.context && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={withContext}
            onChange={(event) => setWithContext(event.target.checked)}
          />
          Include the sentence it appears in ({subject.context.length} characters from
          your document)
        </label>
      )}

      <label htmlFor={previewId}>
        Exactly what will be sent — nothing else goes with it
      </label>
      <textarea
        id={previewId}
        className="report-preview"
        rows={12}
        readOnly
        value={markdown}
      />

      <div className="toolbar report-actions">
        <button type="button" className="primary" onClick={() => void copy()}>
          Copy
        </button>
        <button
          type="button"
          onClick={() =>
            saveReport(
              markdown,
              `recite-report-${(subject.ruleId ?? "citation").toLowerCase()}.md`,
            )
          }
        >
          Save as a file
        </button>
        <button
          type="button"
          disabled={!link.url}
          title={link.reason ?? "Opens GitHub in a new tab, with this filled in"}
          onClick={() => {
            if (!link.url) return;
            if (!openIssue(link.url)) {
              setStatus("A pop-up blocker stopped that. Copy the report instead.");
            }
          }}
        >
          Open an issue on GitHub ↗
        </button>
        <span className="spacer" />
        <button type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>

      <p className="status" role="status">
        {status || link.reason || `Filed as: ${reportTitle(composed)}`}
      </p>
    </dialog>
  );
}
