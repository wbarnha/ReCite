/** Web app entry point. */

import { StrictMode, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { Annotations } from "./components/Annotations.js";
import { AuthorityPicker } from "./components/AuthorityPicker.js";
import { DocumentEditor } from "./components/DocumentEditor.js";
import { FileDrop } from "./components/FileDrop.js";
import { Findings } from "./components/Findings.js";
import { Footer } from "./components/Footer.js";
import { SaveAs } from "./components/SaveAs.js";
import { OcrPicker } from "./components/OcrPicker.js";
import { ProfilePicker } from "./components/ProfilePicker.js";
import { BUILD_INFO, SHORT_COMMIT } from "./build-info.js";
import { AUTHORITY_PROVENANCE } from "./authority.js";
import type { EditorHandle } from "./document/host.js";
import { EditorHost } from "./document/host.js";
import type { RichDocument } from "./document/model.js";
import { richFromText } from "./document/model.js";
import { BrowserHost } from "./host.js";
import type { ImportResult } from "./import/index.js";
import type { OcrMode, OcrSettings } from "./import/ocr-options.js";
import { DEFAULT_OCR_SETTINGS, workersFromQuery } from "./import/ocr-options.js";
import { cacheSize, forgetAll } from "./import/cache.js";
import { charsPerSecond, describePhases, formatMs } from "./import/metrics.js";
import type { ReportContext } from "./export/index.js";
import { SAMPLE_CORPUS, SAMPLE_TEXT } from "./sample.js";
import { revealInTextarea } from "./textarea.js";
import "./styles.css";
import { describeProfile, UPSTREAM_REVISION } from "@recite/core";

import { useReCite } from "./useReCite.js";

function WebApp() {
  const [draft, setDraft] = useState("");
  // Kept so the status line can say what was opened and repeat any warning the
  // reader raised — an OCR caveat in particular must stay visible after the
  // import finishes, not flash past in a progress line.
  const [imported, setImported] = useState<(ImportResult & { name: string }) | null>(
    null,
  );
  /**
   * The document to edit, or `null` for the plain-text surface.
   *
   * Set when a file is opened, and only then. Somebody pasting a paragraph to
   * check one citation wants a text box; somebody who has just opened an
   * eleven-page filing wants to see the filing. The toggle below exists so
   * neither is a trap.
   */
  const [opened, setOpened] = useState<RichDocument | null>(null);
  const [plainText, setPlainText] = useState(false);
  const [ocr, setOcr] = useState<OcrSettings>(() => ({
    ...DEFAULT_OCR_SETTINGS,
    workers: workersFromQuery(window.location.search),
  }));
  const editor = useRef<HTMLTextAreaElement>(null);
  const page = useRef<EditorHandle>(null);

  const editing = opened !== null && !plainText;

  // The surface is the document — reads come from the live DOM so that
  // checking always reflects what the user can see, not a stale copy. Two
  // hosts, because a textarea is edited by string surgery and a formatted
  // document is not.
  const textareaHost = useMemo(
    () =>
      new BrowserHost(
        () => editor.current?.value ?? "",
        (next) => setDraft(next),
        // Selecting a span does not bring it into view; a citation
        // highlighted below the fold looks like a button that did nothing.
        (start, end) => {
          const node = editor.current;
          if (node) revealInTextarea(node, start, end);
        },
      ),
    [],
  );
  const editorHost = useMemo(() => new EditorHost(() => page.current), []);
  const host = editing ? editorHost : textareaHost;

  const recite = useReCite({ host, corpus: SAMPLE_CORPUS });

  const loadSample = useCallback(() => {
    setDraft(SAMPLE_TEXT);
    setImported(null);
    // Pasted text, not an opened document: back to the text box.
    setOpened(null);
  }, []);

  // Everything a saved report needs to stand on its own: what was checked,
  // against which edition, and which build said so.
  const reportContext: ReportContext = useMemo(
    () => ({
      documentName: imported?.name ?? "document",
      profile: describeProfile(recite.profile),
      citationCount: recite.result?.extraction.citations.length ?? 0,
      findings: (recite.result?.diagnostics ?? []).map((diagnostic) => ({
        ruleId: diagnostic.ruleId,
        // `context` values are `unknown`; anything that is not a string is
        // not a rule name, and falling back to the id is more useful than
        // "[object Object]".
        ruleName:
          typeof diagnostic.context?.["name"] === "string"
            ? diagnostic.context["name"]
            : diagnostic.ruleId,
        severity: diagnostic.severity,
        message: diagnostic.message,
        citation: diagnostic.citationText,
        start: diagnostic.span.start,
        end: diagnostic.span.end,
        ...(diagnostic.correction
          ? { suggestion: diagnostic.correction.replacement }
          : {}),
      })),
      version: BUILD_INFO.version,
      commit: SHORT_COMMIT,
      reporterData: UPSTREAM_REVISION,
      authority: AUTHORITY_PROVENANCE[recite.authoritySource],
      annotations: recite.annotations.map((annotation) => ({
        citation: annotation.citation,
        caseName: annotation.caseName,
        ...(annotation.pinCite ? { pinCite: annotation.pinCite } : {}),
        ...(annotation.quotation ? { quotation: annotation.quotation } : {}),
        ...(annotation.url ? { url: annotation.url } : {}),
        source: annotation.source,
        ...(annotation.note ? { note: annotation.note } : {}),
        start: annotation.span.start,
        end: annotation.span.end,
      })),
    }),
    [
      imported,
      recite.annotations,
      recite.authoritySource,
      recite.profile,
      recite.result,
    ],
  );

  return (
    <div className="app">
      <header className="masthead">
        <h1>ReCite</h1>
        <span className="tagline">
          Find and fix broken case law citations — in your browser, or in Word.
        </span>
      </header>

      <div className="notice">
        <p>
          <strong>Your document does not leave this page.</strong> Reading the file, the
          OCR for scanned PDFs and the whole rule set run in your browser. There is no
          ReCite server, and your browser is configured to refuse a request to anywhere
          but this app&rsquo;s own address — with one exception, below.
        </p>
        <p>
          If you supply a <strong>CourtListener</strong> token, ReCite asks that one
          service whether each cited case exists, and can read the page a pin cite
          points at. What it sends is a volume, a reporter and a page — never your text.
          It is off until you turn it on.{" "}
          <a href="./privacy.html">How both claims are enforced</a>
        </p>
      </div>

      <div className="columns">
        <section>
          <h2>Document</h2>
          <div className="toolbar">
            <OcrPicker
              settings={ocr}
              disabled={recite.busy}
              onMode={(mode: OcrMode) => setOcr((current) => ({ ...current, mode }))}
            />
          </div>
          <FileDrop
            ocr={ocr}
            disabled={recite.busy}
            onImported={(result, name) => {
              setDraft(result.text);
              setImported({ ...result, name });
              // A supplied file becomes a document. `richFromText` builds a
              // fresh object every time, which is what tells the editor a new
              // document has arrived rather than the same one re-rendered.
              setOpened(richFromText(result.text));
              setPlainText(false);
            }}
          />
          {imported && (
            <div className="notice import-notice">
              <p>
                Opened <strong>{imported.name}</strong> — {imported.format},{" "}
                {imported.text.length.toLocaleString("en-US")} characters.
              </p>
              {imported.warnings.map((warning) => (
                <p key={warning} className="import-warning">
                  {warning}
                </p>
              ))}
              {imported.metrics && (
                <p className="import-timing">
                  {imported.metrics.cacheHit
                    ? "Read from this session's memory — no recognition was run."
                    : `Took ${formatMs(imported.metrics.totalMs)} — ${describePhases(imported.metrics)}`}
                  {!imported.metrics.cacheHit &&
                    charsPerSecond(imported.metrics) !== undefined && (
                      <>
                        {" "}
                        ({charsPerSecond(imported.metrics)?.toLocaleString(
                          "en-US",
                        )}{" "}
                        characters/second)
                      </>
                    )}
                  {cacheSize() > 0 && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="link-like"
                        onClick={() => {
                          forgetAll();
                          setImported(null);
                        }}
                      >
                        Forget opened documents
                      </button>
                    </>
                  )}
                </p>
              )}
            </div>
          )}
          {editing ? (
            <DocumentEditor
              ref={page}
              initial={opened}
              diagnostics={recite.result?.diagnostics ?? []}
              annotations={recite.annotations}
              onInput={setDraft}
              onReveal={recite.reveal}
              disabled={recite.busy}
            />
          ) : (
            <textarea
              ref={editor}
              rows={26}
              value={draft}
              spellCheck={false}
              placeholder="Paste a brief, a memo, or any text containing citations…"
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Document text"
            />
          )}
          {opened && (
            <div className="toolbar">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={plainText}
                  disabled={recite.busy}
                  onChange={(event) => {
                    // Switching back to the editor re-seeds it from whatever
                    // the text box now holds, so an edit made in either
                    // surface survives the trip. Formatting does not, and the
                    // label says so.
                    if (!event.target.checked) setOpened(richFromText(draft));
                    setPlainText(event.target.checked);
                  }}
                />
                Edit as plain text instead (drops any formatting you applied)
              </label>
            </div>
          )}
          <div className="toolbar">
            <button
              type="button"
              className="primary"
              onClick={() => void recite.check()}
              disabled={recite.busy || draft.trim().length === 0}
            >
              Check citations
            </button>
            <button
              type="button"
              onClick={() => void recite.fixAll()}
              disabled={recite.busy || recite.fixableCount === 0}
            >
              Fix {recite.fixableCount || ""}
            </button>
            <button
              type="button"
              onClick={() => void recite.annotate()}
              disabled={recite.busy || !recite.canAnnotate}
              title="Read the page each pin cite points at, and keep it as a comment"
            >
              Pull pincites
            </button>
            <button type="button" onClick={loadSample} disabled={recite.busy}>
              Load sample
            </button>
            <span className="spacer" />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={recite.allowUnsafe}
                onChange={(event) => recite.setAllowUnsafe(event.target.checked)}
              />
              Include fixes that need review
            </label>
          </div>
          <div className="status" role="status">
            {recite.status}
          </div>

          <SaveAs
            text={draft}
            context={reportContext}
            comments={recite.comments}
            document={editing ? () => page.current?.document() : undefined}
            disabled={recite.busy}
          />
        </section>

        <section>
          <h2>Findings</h2>
          <ProfilePicker
            profile={recite.profile}
            onEdition={recite.setEdition}
            onStyle={recite.setStyle}
            disabled={recite.busy}
          />
          <AuthorityPicker
            source={recite.authoritySource}
            onSource={recite.setAuthoritySource}
            token={recite.token}
            onToken={recite.setToken}
            tokenUsable={recite.tokenUsable}
            hasCorpus={recite.hasCorpus}
            disabled={recite.busy}
          />
          <Findings
            text={recite.result?.text ?? draft}
            diagnostics={recite.result?.diagnostics ?? []}
            citationCount={recite.result?.extraction.citations.length ?? 0}
            checked={recite.result !== null}
            onReveal={recite.reveal}
            onApply={(diagnostic) => void recite.applyOne(diagnostic)}
          />

          <Annotations
            annotations={recite.annotations}
            notices={recite.notices}
            onReveal={recite.reveal}
            destination="Saved into the file as real comments when you choose Word or OpenDocument under Save as."
          />
        </section>
      </div>

      <Footer />
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("ReCite: #root is missing from the page");

createRoot(container).render(
  <StrictMode>
    <WebApp />
  </StrictMode>,
);
