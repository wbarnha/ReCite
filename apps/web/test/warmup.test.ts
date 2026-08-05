/**
 * What the warmup will and will not download.
 *
 * The behaviour under test is a restraint, not a feature: the engine is tens
 * of megabytes, and `docs/security.md` and the README both promise that only
 * someone who opens a PDF pays for it. Warming has to make that faster without
 * making it untrue.
 */

import { describe, expect, it } from "vitest";

import { dragCarriesPdf } from "../src/import/warmup.js";

/** The parts of `DataTransfer` a `dragover` handler can actually see. */
function drag(items: ReadonlyArray<{ kind: string; type: string }>): DataTransfer {
  return { items } as unknown as DataTransfer;
}

describe("deciding whether to warm from a drag", () => {
  it("warms for a PDF", () => {
    expect(dragCarriesPdf(drag([{ kind: "file", type: "application/pdf" }]))).toBe(
      true,
    );
  });

  it("does not warm for a Word document", () => {
    // The whole point of reading the type during `dragover`: someone dragging
    // a .docx should download nothing at all.
    const docx =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(dragCarriesPdf(drag([{ kind: "file", type: docx }]))).toBe(false);
  });

  it("does not warm for dragged text", () => {
    // Selecting words in another tab and dragging them over the page is a
    // `dragover` too, and it is not a reason to fetch eleven megabytes.
    expect(dragCarriesPdf(drag([{ kind: "string", type: "text/plain" }]))).toBe(false);
  });

  it("does not warm when the type is unknown", () => {
    // Some platforms report an empty type for a dragged file. Warming on a
    // maybe would download the engine for every Word user, which is the cost
    // this check exists to avoid — so an unknown type is a no.
    expect(dragCarriesPdf(drag([{ kind: "file", type: "" }]))).toBe(false);
  });

  it("warms when a PDF is among several dragged files", () => {
    expect(
      dragCarriesPdf(
        drag([
          { kind: "file", type: "text/plain" },
          { kind: "file", type: "application/pdf" },
        ]),
      ),
    ).toBe(true);
  });

  it("survives a drag with no transfer at all", () => {
    expect(dragCarriesPdf(null)).toBe(false);
    expect(dragCarriesPdf(drag([]))).toBe(false);
  });
});
