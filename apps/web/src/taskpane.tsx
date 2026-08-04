/**
 * Microsoft Word task pane entry point.
 *
 * Word will not render the pane until `Office.onReady` has resolved, so the
 * app mounts inside that callback rather than at module load. If the page is
 * opened outside Word — someone following the URL in a browser — it says so
 * instead of failing silently against an Office API that is not there.
 */

import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";

import { Findings } from "./components/Findings.js";
import { Footer } from "./components/Footer.js";
import { ProfilePicker } from "./components/ProfilePicker.js";
import { WordHost } from "./host.js";
import { SAMPLE_CORPUS } from "./sample.js";
import "./styles.css";
import { useReCite } from "./useReCite.js";

function TaskPane() {
  const host = useMemo(() => new WordHost(), []);
  const recite = useReCite({ host, corpus: SAMPLE_CORPUS });

  return (
    <div className="app pane">
      <header className="masthead">
        <h1>ReCite</h1>
        <span className="tagline">Citation check for this document</span>
      </header>

      <div className="toolbar">
        <button
          type="button"
          className="primary"
          onClick={() => void recite.check()}
          disabled={recite.busy}
        >
          {recite.busy ? "Working…" : "Check document"}
        </button>
        <button
          type="button"
          onClick={() => void recite.fixAll()}
          disabled={recite.busy || recite.fixableCount === 0}
        >
          Fix {recite.fixableCount || ""}
        </button>
      </div>

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
            checked={recite.allowUnsafe}
            onChange={(event) => recite.setAllowUnsafe(event.target.checked)}
          />
          Include fixes that need review
        </label>
      </div>

      <div className="status" role="status">
        {recite.status}
      </div>

      <Findings
        text={recite.result?.text ?? ""}
        diagnostics={recite.result?.diagnostics ?? []}
        citationCount={recite.result?.extraction.citations.length ?? 0}
        checked={recite.result !== null}
        onReveal={recite.reveal}
        onApply={(diagnostic) => void recite.applyOne(diagnostic)}
      />

      <Footer compact />
    </div>
  );
}

function OutsideWord() {
  return (
    <div className="app">
      <header className="masthead">
        <h1>ReCite for Word</h1>
      </header>
      <div className="notice">
        <p>
          This page is the task pane for the ReCite Word add-in. It needs to run inside
          Word, which supplies the document.
        </p>
        <p>
          To install it, open Word, choose{" "}
          <strong>Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in</strong>
          , and point it at <a href="./manifest.xml">manifest.xml</a>.
        </p>
        <p>
          To check a document without installing anything, use the{" "}
          <a href="./">web version</a>.
        </p>
      </div>
      <Footer />
    </div>
  );
}

function mount(element: React.ReactElement): void {
  const container = document.getElementById("root");
  if (!container) throw new Error("ReCite: #root is missing from the page");
  createRoot(container).render(<StrictMode>{element}</StrictMode>);
}

if (typeof Office === "undefined") {
  mount(<OutsideWord />);
} else {
  void Office.onReady((info) => {
    mount(info.host === Office.HostType.Word ? <TaskPane /> : <OutsideWord />);
  });
}
