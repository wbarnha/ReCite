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

import { Annotations } from "./components/Annotations.js";
import { AuthorityPicker } from "./components/AuthorityPicker.js";
import { Findings } from "./components/Findings.js";
import { Footer } from "./components/Footer.js";
import { ProfilePicker } from "./components/ProfilePicker.js";
import { ReportDialog } from "./components/ReportDialog.js";
import { BUILD_INFO, REPO_URL, SHORT_COMMIT } from "./build-info.js";
import { AUTHORITY_PROVENANCE } from "./authority.js";
import type { ReportEnvironment } from "./feedback/report.js";
import { WordHost } from "./host.js";
import { SAMPLE_CORPUS } from "./sample.js";
import { describeProfile, UPSTREAM_REVISION } from "@recite/core";
import "./styles.css";
import { useReCite } from "./useReCite.js";

function TaskPane() {
  const host = useMemo(() => new WordHost(), []);
  const recite = useReCite({ host, corpus: SAMPLE_CORPUS });

  // Word reads no file of its own, so there is no OCR caveat here — the rest
  // is what makes a report actionable rather than a round trip.
  const reportEnvironment: ReportEnvironment = useMemo(
    () => ({
      profile: describeProfile(recite.profile),
      authority: AUTHORITY_PROVENANCE[recite.authoritySource],
      version: BUILD_INFO.version,
      commit: SHORT_COMMIT,
      reporterData: UPSTREAM_REVISION,
      format: "the open Word document",
    }),
    [recite.authoritySource, recite.profile],
  );

  return (
    <div className="app pane">
      <header className="masthead">
        <h1>ReCite</h1>
        <span className="tagline">Citation check for this document</span>
      </header>

      {/*
        Stated here, not only in the footer. This pane is the one that opens on
        a real client document, so the person reading it is the person whose
        confidentiality obligation is engaged.
      */}
      <div className="notice">
        This document stays on your machine. Checking runs inside Word; the text is
        never uploaded. Supplying a CourtListener token below lets ReCite ask that one
        service whether each cited case exists — it sends a volume, a reporter and a
        page, and nothing else.{" "}
        <a href="./privacy.html" target="_blank" rel="noreferrer">
          Details
        </a>
      </div>

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
        <button
          type="button"
          onClick={() => void recite.annotate()}
          disabled={recite.busy || !recite.canAnnotate}
          title="Read the page each pin cite points at, and add it as a Word comment"
        >
          Comment pincites
        </button>
      </div>

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
        onReport={recite.reportFinding}
      />

      <p className="report-prompt">
        Got a citation wrong, or missed one?{" "}
        <button type="button" className="link-like" onClick={recite.reportCitation}>
          Report it
        </button>{" "}
        — select it in the document first and it will be filled in.
      </p>

      <Annotations
        annotations={recite.annotations}
        notices={recite.notices}
        onReveal={recite.reveal}
        destination="Written into the document as Word comments, next to the citation each one is about."
      />

      {/*
        Mounted only while it is open, so its fields start out holding this
        report rather than the previous one.
      */}
      {recite.reporting && (
        <ReportDialog
          subject={recite.reporting}
          environment={reportEnvironment}
          repoUrl={REPO_URL}
          onClose={recite.closeReport}
        />
      )}

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
