import type { Diagnostic } from "@recite/core";
import type { Annotation } from "@recite/courtlistener";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type { EditorHandle } from "../document/host.js";
import type { HighlightName } from "../document/highlight.js";
import { flash, highlightsSupported, paint } from "../document/highlight.js";
import type { MarkName, RichDocument } from "../document/model.js";
import { applyCorrectionsRich, richToText, toggleMark } from "../document/model.js";
import {
  offsetOf,
  rangeFor,
  read,
  render,
  selectionOffsets,
  selectOffsets,
} from "../document/dom.js";

/** How long to wait after a keystroke before re-deriving anything. */
const SETTLE_MS = 250;

const MARKS: ReadonlyArray<{ mark: MarkName; label: string; key: string }> = [
  { mark: "bold", label: "B", key: "Bold (Ctrl+B)" },
  { mark: "italic", label: "I", key: "Italic (Ctrl+I)" },
  { mark: "underline", label: "U", key: "Underline (Ctrl+U)" },
];

const LAYER: Record<Diagnostic["severity"], HighlightName> = {
  error: "recite-error",
  warning: "recite-warning",
  info: "recite-info",
};

export interface DocumentEditorProps {
  /** Jump to a span — the same action the findings panel uses. */
  readonly onReveal?: (start: number, end: number) => void;
  /**
   * The document to edit. Read once, when its identity changes.
   *
   * The DOM is the document while the editor is open — the same arrangement
   * the textarea has always had, and the only one that does not fight the
   * caret. Re-rendering on every keystroke from React state would put the
   * cursor back at the start of the paragraph on every character typed.
   */
  readonly initial: RichDocument;
  readonly diagnostics: readonly Diagnostic[];
  readonly annotations: readonly Annotation[];
  /** Called with the plain text after the document settles. */
  readonly onInput: (text: string) => void;
  readonly disabled?: boolean;
}

interface Bubble {
  readonly annotation: Annotation;
  readonly top: number;
}

/**
 * The document, as a document.
 *
 * A textarea is the right control for pasting a paragraph and checking it. It
 * is the wrong one for a brief: a lawyer who opens a filing wants to see a
 * page, with the findings marked where they are and the quotations in the
 * margin, which is what every other tool in their day looks like.
 *
 * Three things make that work without a rich-text library:
 *
 * - **Marks live in the model, not in `execCommand`.** Bolding a selection
 *   reads the DOM into a `RichDocument`, toggles the mark over an offset
 *   range, and renders back. Deterministic, and it survives a fix landing in
 *   the middle of a bold citation.
 * - **Findings are painted, not wrapped.** The CSS Custom Highlight API marks
 *   ranges without touching the DOM, so ReCite's own markup never ends up in
 *   the saved file. Where the API is missing, the findings panel still lists
 *   everything and `Show` still selects it.
 * - **Comments sit in a margin**, positioned against the citation they are
 *   about, and are written into the `.docx` on save.
 */
export const DocumentEditor = forwardRef<EditorHandle, DocumentEditorProps>(
  function DocumentEditor(
    { initial, diagnostics, annotations, onInput, onReveal, disabled = false },
    ref,
  ) {
    const host = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLDivElement>(null);
    const [bubbles, setBubbles] = useState<readonly Bubble[]>([]);
    const [active, setActive] = useState<number | null>(null);

    // Seed the surface. Identity, not content: a new object means a new
    // document was opened, and anything else would clobber what was typed.
    useEffect(() => {
      const node = host.current;
      if (!node) return;
      render(node, initial);
      onInput(richToText(initial));
      // `onInput` is the caller's identity and would re-seed the editor on
      // every parent render; the document is what this effect is about.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initial]);

    /** Paint the findings and reposition the margin. Cheap enough to redo. */
    const refresh = useCallback(() => {
      const node = host.current;
      const box = frame.current;
      if (!node || !box) return;

      const document_ = read(node);
      const layers: Partial<Record<HighlightName, Range[]>> = {};

      for (const diagnostic of diagnostics) {
        const range = rangeFor(
          node,
          document_,
          diagnostic.span.start,
          diagnostic.span.end,
        );
        if (!range) continue;
        (layers[LAYER[diagnostic.severity]] ??= []).push(range);
      }

      const placed: Bubble[] = [];
      const top = box.getBoundingClientRect().top;
      let floor = 0;

      for (const annotation of annotations) {
        const range = rangeFor(
          node,
          document_,
          annotation.span.start,
          annotation.span.end,
        );
        if (!range) continue;
        (layers["recite-annotation"] ??= []).push(range.cloneRange());

        // Anchored to the citation, then pushed down far enough not to sit on
        // top of the one before it — which is what a margin of comments does.
        const wanted = range.getBoundingClientRect().top - top;
        const at = Math.max(wanted, floor);
        floor = at + 84;
        placed.push({ annotation, top: at });
      }

      paint(layers);
      setBubbles(placed);
    }, [annotations, diagnostics]);

    // Findings and quotations change from outside; the document changes from
    // inside. Both have to redraw, and a resize moves every bubble.
    useEffect(() => {
      refresh();
      const onResize = () => refresh();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, [refresh]);

    /** Undoes the last jump's flash, so a second click replaces the first. */
    const cancelFlash = useRef<(() => void) | null>(null);
    useEffect(() => () => cancelFlash.current?.(), []);

    const settle = useRef<number | undefined>(undefined);
    const onEdit = useCallback(() => {
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => {
        const node = host.current;
        if (!node) return;
        onInput(richToText(read(node)));
        refresh();
      }, SETTLE_MS);
    }, [onInput, refresh]);

    const applyMark = useCallback(
      (mark: MarkName) => {
        const node = host.current;
        if (!node || disabled) return;

        const selection = selectionOffsets(node);
        if (!selection || selection.end <= selection.start) return;

        const next = toggleMark(read(node), selection.start, selection.end, mark);
        render(node, next);
        selectOffsets(node, next, selection.start, selection.end);
        onInput(richToText(next));
        refresh();
      },
      [disabled, onInput, refresh],
    );

    useImperativeHandle(
      ref,
      (): EditorHandle => ({
        text: () => {
          const node = host.current;
          return node ? richToText(read(node)) : "";
        },
        document: () => {
          const node = host.current;
          return node ? read(node) : { paragraphs: [] };
        },
        apply: (corrections) => {
          const node = host.current;
          if (!node) return { applied: 0, skipped: corrections.length };

          const patch = applyCorrectionsRich(read(node), corrections);
          render(node, patch.document);
          const text = richToText(patch.document);
          onInput(text);
          return {
            applied: patch.applied.length,
            skipped: patch.skipped.length,
            text,
          };
        },
        selection: () => {
          const node = host.current;
          const selected = node?.ownerDocument.getSelection();
          // Only what is inside the page: a selection that started in the
          // findings panel is not part of the document.
          if (!node || !selected || selected.rangeCount === 0) return "";
          const range = selected.getRangeAt(0);
          return node.contains(range.commonAncestorContainer)
            ? selected.toString()
            : "";
        },

        reveal: (start, end, expected) => {
          const node = host.current;
          const box = frame.current;
          if (!node || !box) {
            return { found: false, reason: "the editor is not open" };
          }

          const document_ = read(node);
          // Checked against what is in the editor now. Offsets from the last
          // check describe a document that may since have been typed into, and
          // pointing confidently at whatever now sits there would name an
          // innocent citation as the finding.
          if (
            expected !== undefined &&
            richToText(document_).slice(start, end) !== expected
          ) {
            return {
              found: false,
              reason: "the document has changed since the check — check it again",
            };
          }

          const range = rangeFor(node, document_, start, end);
          if (!range) {
            return {
              found: false,
              reason: "that citation is no longer in the document — check it again",
            };
          }

          // `preventScroll`, or focusing the page would scroll the window to
          // it — undoing the whole point of scrolling the frame below, and
          // taking the panel the click came from off screen.
          node.focus({ preventScroll: true });
          selectOffsets(node, document_, start, end);

          // Scroll the frame, not the page. The frame is the element with the
          // overflow, and `scrollIntoView` on an ancestor of the range would
          // move the whole window instead — jarring, and it loses the panel of
          // findings the click came from.
          const citation = range.getBoundingClientRect();
          const visible = box.getBoundingClientRect();
          box.scrollTop +=
            citation.top - visible.top - visible.height / 2 + citation.height / 2;

          cancelFlash.current?.();
          cancelFlash.current = flash(range);
          return { found: true };
        },
      }),
      [onInput],
    );

    return (
      <div className="editor">
        <div className="toolbar editor-toolbar">
          {MARKS.map(({ mark, label, key }) => (
            <button
              key={mark}
              type="button"
              className={`mark mark-${mark}`}
              title={key}
              aria-label={key}
              disabled={disabled}
              // The selection is lost the moment a button takes focus.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyMark(mark)}
            >
              {label}
            </button>
          ))}
          <span className="spacer" />
          <span className="editor-hint">
            {highlightsSupported()
              ? "Findings are marked in the text; quotations sit in the margin."
              : "This browser cannot paint findings in the text — the list beside the document has every one, with a line number."}
          </span>
        </div>

        <div className="editor-frame" ref={frame}>
          <div
            ref={host}
            className="page"
            role="textbox"
            tabIndex={0}
            aria-multiline="true"
            aria-label="Document text"
            contentEditable={!disabled}
            suppressContentEditableWarning
            spellCheck={false}
            onInput={onEdit}
            onBlur={onEdit}
            onKeyDown={(event) => {
              if (!(event.ctrlKey || event.metaKey)) return;
              const mark = { b: "bold", i: "italic", u: "underline" }[
                event.key.toLowerCase()
              ] as MarkName | undefined;
              if (!mark) return;
              event.preventDefault();
              applyMark(mark);
            }}
            onClick={(event) => {
              // Clicking near a citation brings its quotation forward, the way
              // clicking a comment anchor does in Word.
              const node = host.current;
              if (!node || bubbles.length === 0) return;
              const selection = node.ownerDocument.getSelection();
              if (!selection?.focusNode) return;
              const at = offsetOf(node, selection.focusNode, selection.focusOffset);
              if (at === undefined) return;
              const hit = bubbles.find(
                ({ annotation }) =>
                  at >= annotation.span.start && at <= annotation.span.end,
              );
              setActive(hit ? hit.annotation.citationIndex : null);
              event.stopPropagation();
            }}
          />

          <div className="editor-margin" aria-label="Pincite quotations">
            {bubbles.map(({ annotation, top }) => (
              <article
                key={`${annotation.citationIndex}-${annotation.span.start}`}
                className={
                  `margin-note${annotation.quotation ? "" : " unquoted"}` +
                  (active === annotation.citationIndex ? " active" : "")
                }
                style={{ top: `${top}px` }}
              >
                {/*
                  The note points at a citation, so clicking it goes there —
                  the mirror of clicking the citation to bring the note
                  forward. A heading is the affordance a reader expects to be
                  the link.
                */}
                <button
                  type="button"
                  className="margin-note-jump"
                  onClick={() => {
                    setActive(annotation.citationIndex);
                    onReveal?.(annotation.span.start, annotation.span.end);
                  }}
                >
                  {annotation.caseName}
                  {annotation.pinCite ? `, at ${annotation.pinCite}` : ""}
                </button>
                {annotation.quotation ? (
                  <blockquote>{annotation.quotation}</blockquote>
                ) : (
                  <p className="annotation-missing">{annotation.note}</p>
                )}
                {annotation.url && (
                  <a href={annotation.url} target="_blank" rel="noreferrer noopener">
                    {annotation.source}
                  </a>
                )}
              </article>
            ))}
          </div>
        </div>
      </div>
    );
  },
);
