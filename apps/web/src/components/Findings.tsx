import type { Diagnostic, Severity } from "@recite/core";
import { lineCol } from "@recite/core";

export interface FindingsProps {
  readonly text: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly citationCount: number;
  readonly onReveal?: (start: number, end: number) => void;
  readonly onApply?: (diagnostic: Diagnostic) => void;
  readonly checked: boolean;
}

const SEVERITY_ORDER: readonly Severity[] = ["error", "warning", "info"];

export function Findings({
  text,
  diagnostics,
  citationCount,
  onReveal,
  onApply,
  checked,
}: FindingsProps) {
  if (!checked) {
    return (
      <div className="empty">
        Paste a brief, or load the sample, then choose <strong>Check</strong>.
      </div>
    );
  }

  if (diagnostics.length === 0) {
    return (
      <div className="empty">
        <p>
          <strong>No problems found</strong> in {citationCount}{" "}
          {citationCount === 1 ? "citation" : "citations"}.
        </p>
        <p style={{ fontSize: "0.8rem" }}>
          ReCite proves specific things are wrong. A clean run is not proof that a
          citation is right.
        </p>
      </div>
    );
  }

  const counts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: diagnostics.filter((d) => d.severity === severity).length,
  })).filter((entry) => entry.count > 0);

  return (
    <>
      <div className="summary">
        {counts.map(({ severity, count }) => (
          <span key={severity} className={`pill ${severity}`}>
            {count} {severity}
            {count === 1 ? "" : "s"}
          </span>
        ))}
        <span className="pill">
          {citationCount} {citationCount === 1 ? "citation" : "citations"}
        </span>
      </div>

      {diagnostics.map((diagnostic, i) => (
        <Finding
          key={`${diagnostic.ruleId}-${diagnostic.span.start}-${i}`}
          text={text}
          diagnostic={diagnostic}
          onReveal={onReveal}
          onApply={onApply}
        />
      ))}
    </>
  );
}

function Finding({
  text,
  diagnostic,
  onReveal,
  onApply,
}: {
  text: string;
  diagnostic: Diagnostic;
  onReveal?: (start: number, end: number) => void;
  onApply?: (diagnostic: Diagnostic) => void;
}) {
  const [line, column] = lineCol(text, diagnostic.span.start);
  const fix = diagnostic.correction;

  return (
    <article className={`finding ${diagnostic.severity}`}>
      <header>
        <span className="severity">{diagnostic.severity}</span>
        <span className="rule">{diagnostic.ruleId}</span>
        <span>
          line {line}, col {column}
        </span>
      </header>

      <p>{diagnostic.message}</p>

      {/*
        The citation is the jump. A finding is a claim about a specific run of
        characters somewhere in the document, and the natural way to ask "where
        is that?" is to click the thing itself — not to hunt for a button
        labelled Show. It is a real `<button>`, so it is reachable by keyboard
        and announced as an action.
      */}
      {onReveal ? (
        <button
          type="button"
          className="cite jump"
          title="Go to this citation in the document"
          onClick={() => onReveal(diagnostic.span.start, diagnostic.span.end)}
        >
          {diagnostic.citationText}
        </button>
      ) : (
        <div className="cite">{diagnostic.citationText}</div>
      )}

      {fix && (
        <div className={`fix ${fix.safety === "unsafe" ? "unsafe" : ""}`}>
          {fix.safety === "unsafe" ? "suggested (review): " : "fix: "}
          {JSON.stringify(text.slice(fix.span.start, fix.span.end))} →{" "}
          {JSON.stringify(fix.replacement)}
        </div>
      )}

      {fix && onApply && (
        <div className="actions">
          <button type="button" onClick={() => onApply(diagnostic)}>
            Apply this fix
          </button>
        </div>
      )}
    </article>
  );
}
