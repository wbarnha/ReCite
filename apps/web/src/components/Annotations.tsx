import type { Annotation } from "@recite/courtlistener";

export interface AnnotationsProps {
  readonly annotations: readonly Annotation[];
  readonly notices: readonly string[];
  readonly onReveal?: (start: number, end: number) => void;
  /** Where the comments will end up, said once rather than guessed at. */
  readonly destination: string;
}

/**
 * The passages behind the pin cites, listed beside the findings.
 *
 * A quotation here is not a finding — nothing is wrong — so it is deliberately
 * a different shape from a `Finding`. What it is, is the sentence the brief is
 * relying on, next to the citation that claims it, which is the check a
 * supervising partner would do by hand.
 *
 * An entry with no quotation is shown rather than hidden. "Page 678 is not
 * marked in CourtListener's copy" is information; silently dropping the
 * citation would let a reader believe every pin cite had been checked.
 */
export function Annotations({
  annotations,
  notices,
  onReveal,
  destination,
}: AnnotationsProps) {
  if (annotations.length === 0 && notices.length === 0) return null;

  const quoted = annotations.filter((annotation) => annotation.quotation).length;

  return (
    <section className="annotations">
      <h3>
        Pincite quotations{" "}
        {annotations.length > 0 && (
          <span className="pill">
            {quoted} of {annotations.length} quoted
          </span>
        )}
      </h3>

      {notices.map((notice) => (
        <p key={notice} className="import-warning">
          {notice}
        </p>
      ))}

      {annotations.length > 0 && <p className="annotations-note">{destination}</p>}

      {annotations.map((annotation) => (
        <article
          key={`${annotation.citationIndex}-${annotation.span.start}`}
          className={`annotation${annotation.quotation ? "" : " unquoted"}`}
        >
          <header>
            <span className="cite">{annotation.citation}</span>
            {annotation.pinCite && <span>at {annotation.pinCite}</span>}
          </header>

          <p className="annotation-case">{annotation.caseName}</p>

          {annotation.quotation ? (
            <blockquote>{annotation.quotation}</blockquote>
          ) : (
            <p className="annotation-missing">{annotation.note}</p>
          )}

          <div className="actions">
            {onReveal && (
              <button
                type="button"
                onClick={() => onReveal(annotation.span.start, annotation.span.end)}
              >
                Show
              </button>
            )}
            {annotation.url && (
              <a href={annotation.url} target="_blank" rel="noreferrer noopener">
                Read it on {annotation.source}
              </a>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
