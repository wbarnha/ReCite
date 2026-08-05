/** Web app entry point. */

import { StrictMode, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { FileDrop } from "./components/FileDrop.js";
import { Findings } from "./components/Findings.js";
import { Footer } from "./components/Footer.js";
import { ProfilePicker } from "./components/ProfilePicker.js";
import { BrowserHost } from "./host.js";
import type { ImportResult } from "./import/index.js";
import { SAMPLE_CORPUS, SAMPLE_TEXT } from "./sample.js";
import "./styles.css";
import { useReCite } from "./useReCite.js";

function WebApp() {
  const [draft, setDraft] = useState("");
  // Kept so the status line can say what was opened and repeat any warning the
  // reader raised — an OCR caveat in particular must stay visible after the
  // import finishes, not flash past in a progress line.
  const [imported, setImported] = useState<(ImportResult & { name: string }) | null>(
    null,
  );
  const editor = useRef<HTMLTextAreaElement>(null);

  // The textarea is the document. Reads come from the live DOM value so that
  // checking always reflects what the user can see, not a stale copy.
  const host = useMemo(
    () =>
      new BrowserHost(
        () => editor.current?.value ?? "",
        (next) => setDraft(next),
        (start, end) => {
          const node = editor.current;
          if (!node) return;
          node.focus();
          node.setSelectionRange(start, end);
        },
      ),
    [],
  );

  const recite = useReCite({ host, corpus: SAMPLE_CORPUS });

  const loadSample = useCallback(() => {
    setDraft(SAMPLE_TEXT);
  }, []);

  return (
    <div className="app">
      <header className="masthead">
        <h1>ReCite</h1>
        <span className="tagline">
          Find and fix broken case law citations — in your browser, or in Word.
        </span>
      </header>

      <div className="notice">
        Nothing you open or paste leaves this page. Reading the file, the OCR for
        scanned PDFs, the rule set and the authority check all run in your browser.
        There is no server — your browser is configured to refuse any request this app
        makes to another origin. <a href="./privacy.html">How this is enforced</a>
      </div>

      <div className="columns">
        <section>
          <h2>Document</h2>
          <FileDrop
            disabled={recite.busy}
            onImported={(result, name) => {
              setDraft(result.text);
              setImported({ ...result, name });
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
            </div>
          )}
          <textarea
            ref={editor}
            rows={26}
            value={draft}
            spellCheck={false}
            placeholder="Paste a brief, a memo, or any text containing citations…"
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Document text"
          />
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
        </section>

        <section>
          <h2>Findings</h2>
          <ProfilePicker
            profile={recite.profile}
            onEdition={recite.setEdition}
            onStyle={recite.setStyle}
            disabled={recite.busy}
          />
          <div className="toolbar">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={recite.useCorpus}
                onChange={(event) => recite.setUseCorpus(event.target.checked)}
              />
              Also check against the sample authority list (5 cases)
            </label>
          </div>
          {recite.useCorpus && (
            <div className="notice">
              The sample list holds five cases, so most citations in any real document
              will be missing from it. That is a prompt to check one by hand — not
              evidence a case does not exist.
            </div>
          )}
          <Findings
            text={recite.result?.text ?? draft}
            diagnostics={recite.result?.diagnostics ?? []}
            citationCount={recite.result?.extraction.citations.length ?? 0}
            checked={recite.result !== null}
            onReveal={recite.reveal}
            onApply={(diagnostic) => void recite.applyOne(diagnostic)}
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
