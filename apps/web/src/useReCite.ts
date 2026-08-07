/**
 * The state machine behind both surfaces.
 *
 * Holds the current document, the last check, and the toggles that change what
 * runs. Keeping it here rather than in a component is what lets the web app
 * and the Word task pane share behaviour without sharing layout.
 */

import type {
  AuthorityRecord,
  BluebookEdition,
  BluebookProfile,
  CitationStyle,
  Correction,
  Diagnostic,
} from "@recite/core";
import { CorpusProvider, DEFAULT_PROFILE } from "@recite/core";
import type { Annotation, CourtListenerProvider } from "@recite/courtlistener";
import {
  annotateCitations,
  annotationComment,
  looksLikeToken,
} from "@recite/courtlistener";
import type { CheckResult } from "@recite/engine";
import { Engine, fixableCorrections } from "@recite/engine";
import { useCallback, useMemo, useRef, useState } from "react";

import type { AuthoritySource } from "./authority.js";
import type { ReportSubject } from "./feedback/report.js";
import { contextAround, subjectFor } from "./feedback/report.js";
import { makeCourtListenerClient, makeCourtListenerProvider } from "./authority.js";
import type { DocumentComment } from "./export/index.js";
import type { DocumentHost } from "./host.js";

export interface UseReCiteOptions {
  readonly host: DocumentHost;
  readonly corpus?: readonly AuthorityRecord[];
}

export function useReCite({ host, corpus }: UseReCiteOptions) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // `none` by default, and deliberately. "Absent from this list" is only as
  // meaningful as the list — a short one produces a page of findings about
  // perfectly real cases, which teaches people to ignore the rule that matters
  // most — and the CourtListener option opens a connection, which nobody
  // should acquire by accident.
  const [authoritySource, setAuthoritySource] = useState<AuthoritySource>("none");
  const [token, setToken] = useState("");
  const [allowUnsafe, setAllowUnsafe] = useState(false);
  const [profile, setProfile] = useState<BluebookProfile>(DEFAULT_PROFILE);
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  const [notices, setNotices] = useState<readonly string[]>([]);

  // Held in a ref so `check` does not need it in its dependency list and thus
  // does not change identity on every keystroke.
  const textRef = useRef(text);
  textRef.current = text;

  /**
   * The live CourtListener provider, kept across checks.
   *
   * It remembers what it has already been told, so applying a fix — which
   * re-checks the document — does not spend another round of rate limit on
   * answers that cannot have changed.
   */
  const courtListener = useRef<{
    token: string;
    provider: CourtListenerProvider;
  } | null>(null);

  const usable = authoritySource === "courtlistener" && looksLikeToken(token);

  const providerFor = useCallback(
    (source: AuthoritySource) => {
      if (source === "sample") {
        return corpus?.length
          ? new CorpusProvider([...corpus], "sample authority list")
          : undefined;
      }
      if (source !== "courtlistener" || !looksLikeToken(token)) return undefined;

      if (courtListener.current?.token !== token) {
        courtListener.current = {
          token,
          provider: makeCourtListenerProvider({ token }),
        };
      }
      return courtListener.current.provider;
    },
    [corpus, token],
  );

  const engine = useMemo(
    () => new Engine({ profile, provider: providerFor(authoritySource) }),
    [authoritySource, profile, providerFor],
  );

  const check = useCallback(async () => {
    setBusy(true);
    setStatus(
      authoritySource === "courtlistener"
        ? "Reading the document, then asking CourtListener…"
        : "Reading the document…",
    );
    try {
      const current = await host.read();
      setText(current);
      // Offsets from the previous document do not describe this one.
      setAnnotations([]);
      const checked = await engine.check(current);
      setResult(checked);
      setNotices(courtListener.current?.provider.notices ?? []);
      setStatus(
        `${checked.diagnostics.length} finding${checked.diagnostics.length === 1 ? "" : "s"} across ${checked.extraction.citations.length} citation${checked.extraction.citations.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setStatus(`Could not check the document: ${describe(error)}`);
    } finally {
      setBusy(false);
    }
  }, [authoritySource, engine, host]);

  /**
   * Pull the passage each pin cite points at.
   *
   * Separate from `check` on purpose. Verification is one request per distinct
   * citation; annotation is one per opinion, and an opinion is a great deal
   * more to download. Someone who only wants to know the cases are real should
   * not pay for the quotations as well.
   */
  const annotate = useCallback(async () => {
    const provider = courtListener.current?.provider;
    if (!result || !provider) {
      setStatus("Check the document against CourtListener first.");
      return;
    }

    setBusy(true);
    setStatus("Reading the cited pages…");
    try {
      const pulled = await annotateCitations(result.extraction, provider.lookups, {
        client: makeCourtListenerClient(token),
        onProgress: (done, total) => setStatus(`Read ${done} of ${total} pin cites…`),
      });
      setAnnotations(pulled.annotations);
      setNotices([...provider.notices, ...pulled.notices]);

      const quoted = pulled.annotations.filter((a) => a.quotation).length;
      setStatus(
        pulled.annotations.length === 0
          ? "No pin cites to read: annotation needs a verified citation with a page."
          : `Quoted ${quoted} of ${pulled.annotations.length} pin cite${pulled.annotations.length === 1 ? "" : "s"}.`,
      );

      // Write them into the document where the host can hold a comment.
      if (host.annotate) {
        const outcome = await host.annotate(
          textRef.current,
          toComments(pulled.annotations),
        );
        setStatus(
          `${outcome.applied} comment${outcome.applied === 1 ? "" : "s"} added to the document` +
            (outcome.skipped ? `; ${outcome.skipped} could not be placed.` : "."),
        );
      }
    } catch (error) {
      setStatus(`Could not read the cited pages: ${describe(error)}`);
    } finally {
      setBusy(false);
    }
  }, [host, result, token]);

  const applyCorrectionList = useCallback(
    async (corrections: readonly Correction[]) => {
      if (corrections.length === 0) {
        setStatus("Nothing to apply.");
        return;
      }
      setBusy(true);
      try {
        const outcome = await host.apply(textRef.current, corrections);
        if (outcome.text !== undefined) setText(outcome.text);
        setStatus(
          `Applied ${outcome.applied} correction${outcome.applied === 1 ? "" : "s"}` +
            (outcome.skipped ? `; ${outcome.skipped} skipped.` : "."),
        );
        // The document changed underneath the report, so re-check rather than
        // leave stale offsets on screen — and drop the annotations, whose
        // spans described the document as it was.
        const next = await host.read();
        setText(next);
        setAnnotations([]);
        setResult(await engine.check(next));
      } catch (error) {
        setStatus(`Could not apply: ${describe(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [engine, host],
  );

  const fixAll = useCallback(async () => {
    if (!result) return;
    await applyCorrectionList(fixableCorrections(result.diagnostics, allowUnsafe));
  }, [applyCorrectionList, allowUnsafe, result]);

  const applyOne = useCallback(
    async (diagnostic: Diagnostic) => {
      if (!diagnostic.correction) return;
      await applyCorrectionList([diagnostic.correction]);
    },
    [applyCorrectionList],
  );

  /**
   * Jump to a citation in the document.
   *
   * Offsets come from the last check, and the document may have been edited
   * since — in Word, possibly by somebody else in another window. A click that
   * silently did nothing would read as a broken button, so a miss says so.
   */
  const reveal = useCallback(
    (start: number, end: number) => {
      void (async () => {
        const outcome = await host.reveal?.(textRef.current, start, end);
        if (outcome && !outcome.found) {
          setStatus(`Could not jump there: ${outcome.reason ?? "not found"}.`);
        }
      })();
    },
    [host],
  );

  /**
   * The finding or citation a report is being written about, or `null`.
   *
   * Held here rather than in a component because both surfaces raise it from
   * two places — a finding, and a citation nothing was said about — and the
   * dialog should not care which.
   */
  const [reporting, setReporting] = useState<ReportSubject | null>(null);

  const reportFinding = useCallback((diagnostic: Diagnostic) => {
    setReporting(subjectFor(diagnostic, textRef.current, true));
  }, []);

  /**
   * Report a citation ReCite said nothing about.
   *
   * The most valuable report there is, and the one nothing else in the app can
   * prompt for: a false positive is attached to a finding you can click, and a
   * miss is attached to nothing at all. Prefilled from the selection when the
   * host can supply one, so the common case is select-and-report.
   */
  const reportCitation = useCallback(() => {
    void (async () => {
      const selected = (await host.selection?.()) ?? "";
      const citation = selected.trim().slice(0, 200);
      const at = citation ? textRef.current.indexOf(citation) : -1;

      setReporting({
        kind: "missed",
        citation,
        ...(at >= 0
          ? {
              context: contextAround(textRef.current, {
                start: at,
                end: at + citation.length,
              }),
            }
          : {}),
      });
    })();
  }, [host]);

  const fixableCount = result
    ? fixableCorrections(result.diagnostics, allowUnsafe).length
    : 0;

  const comments = useMemo(() => toComments(annotations), [annotations]);

  return {
    text,
    setText,
    result,
    busy,
    status,
    notices,
    authoritySource,
    setAuthoritySource,
    token,
    setToken,
    tokenUsable: usable,
    annotations,
    comments,
    annotate,
    canAnnotate: usable && result !== null,
    allowUnsafe,
    setAllowUnsafe,
    profile,
    setEdition: (edition: BluebookEdition) =>
      setProfile((current) => ({ ...current, edition })),
    setStyle: (style: CitationStyle) =>
      setProfile((current) => ({ ...current, style })),
    check,
    fixAll,
    applyOne,
    reveal,
    reporting,
    reportFinding,
    reportCitation,
    closeReport: useCallback(() => setReporting(null), []),
    fixableCount,
    hasCorpus: Boolean(corpus?.length),
  };
}

/** An annotation, in the shape a document writer or a Word host needs. */
export function toComments(
  annotations: readonly Annotation[],
): readonly DocumentComment[] {
  return annotations.map((annotation) => ({
    span: annotation.span,
    text: annotationComment(annotation),
  }));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
