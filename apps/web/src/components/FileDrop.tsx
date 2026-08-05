import { useCallback, useId, useRef, useState } from "react";

import { EXAMPLE, loadExample } from "../example.js";
import type { ImportResult } from "../import/index.js";
import { ACCEPTED_EXTENSIONS, importDocument } from "../import/index.js";

/**
 * Open a document from disk.
 *
 * Drag-and-drop and a file picker, because a brief arrives either way and a
 * tool that only offers one of them makes someone go and find the other.
 *
 * The reading happens in the page. A `File` handed to `FileReader` never
 * involves a network, and the page's Content Security Policy would refuse a
 * request to anywhere but this origin in any case — see `privacy.html`.
 */
export function FileDrop({
  onImported,
  disabled = false,
}: {
  onImported: (result: ImportResult, name: string) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const open = useCallback(
    async (file: File) => {
      setBusy(true);
      setError("");
      setProgress(`Opening ${file.name}…`);
      try {
        const result = await importDocument(file, setProgress);
        onImported(result, file.name);
        setProgress("");
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : String(problem));
        setProgress("");
      } finally {
        setBusy(false);
      }
    },
    [onImported],
  );

  const openExample = useCallback(async () => {
    setBusy(true);
    setError("");
    setProgress(`Fetching the ${EXAMPLE.pages}-page example filing…`);
    try {
      await open(await loadExample());
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setBusy(false);
      setProgress("");
    }
  }, [open]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (disabled || busy) return;
      const file = event.dataTransfer.files[0];
      if (file) void open(file);
    },
    [disabled, busy, open],
  );

  return (
    <div className="filedrop-wrap">
      <div
        className={`filedrop${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <label htmlFor={inputId} className="filedrop-label">
          <strong>Open a document</strong>
          <span>
            Drag a file here, or <span className="link-like">choose one</span>. Word,
            PDF, RTF, OpenDocument, HTML or plain text.
          </span>
          <span className="filedrop-note">
            Scanned PDFs are read with OCR, in your browser. Nothing is uploaded.
          </span>
        </label>
        <input
          id={inputId}
          ref={input}
          type="file"
          className="filedrop-input"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void open(file);
            // Reset so choosing the same file twice fires again — a user who
            // re-saves and re-opens expects it to reload.
            event.target.value = "";
          }}
        />
      </div>

      <div className="filedrop-example">
        <button
          type="button"
          onClick={() => void openExample()}
          disabled={disabled || busy}
        >
          Try the example filing
        </button>
        <span>
          The affirmation from <em>Mata v. Avianca</em> — the brief with six citations
          to cases that did not exist. {EXAMPLE.pages} pages, part scanned, so it takes
          about {EXAMPLE.approximateSeconds} seconds.{" "}
          <a href={`./${EXAMPLE.file}`} download>
            Download the PDF
          </a>{" "}
          &middot; <a href="./tutorial.html">Walkthrough</a>
        </span>
      </div>

      {progress && (
        <p className="filedrop-progress" role="status">
          {progress}
        </p>
      )}
      {error && (
        <p className="filedrop-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
