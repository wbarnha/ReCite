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
import type { CheckResult } from "@recite/engine";
import { Engine, fixableCorrections } from "@recite/engine";
import { useCallback, useMemo, useRef, useState } from "react";

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
  // Off by default, even when a corpus is supplied. Turning it on is a
  // deliberate act, because "absent from this list" is only as meaningful as
  // the list — and a short one produces a page of findings about perfectly
  // real cases, which teaches people to ignore the rule that matters most.
  const [useCorpus, setUseCorpus] = useState(false);
  const [allowUnsafe, setAllowUnsafe] = useState(false);
  const [profile, setProfile] = useState<BluebookProfile>(DEFAULT_PROFILE);

  // Held in a ref so `check` does not need it in its dependency list and thus
  // does not change identity on every keystroke.
  const textRef = useRef(text);
  textRef.current = text;

  const engine = useMemo(
    () =>
      new Engine({
        profile,
        provider:
          useCorpus && corpus?.length
            ? new CorpusProvider([...corpus], "your authority list")
            : undefined,
      }),
    [useCorpus, corpus, profile],
  );

  const check = useCallback(async () => {
    setBusy(true);
    setStatus("Reading the document…");
    try {
      const current = await host.read();
      setText(current);
      setStatus("Checking citations…");
      const checked = await engine.check(current);
      setResult(checked);
      setStatus(
        `${checked.diagnostics.length} finding${checked.diagnostics.length === 1 ? "" : "s"} across ${checked.extraction.citations.length} citation${checked.extraction.citations.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setStatus(`Could not check the document: ${describe(error)}`);
    } finally {
      setBusy(false);
    }
  }, [engine, host]);

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
        // leave stale offsets on screen.
        const next = await host.read();
        setText(next);
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

  const reveal = useCallback(
    (start: number, end: number) => {
      void host.reveal?.(textRef.current, start, end);
    },
    [host],
  );

  const fixableCount = result
    ? fixableCorrections(result.diagnostics, allowUnsafe).length
    : 0;

  return {
    text,
    setText,
    result,
    busy,
    status,
    useCorpus,
    setUseCorpus,
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
    fixableCount,
    hasCorpus: Boolean(corpus?.length),
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
