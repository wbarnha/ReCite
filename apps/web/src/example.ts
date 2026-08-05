/**
 * The worked example: the filing from *Mata v. Avianca*.
 *
 * On 25 May 2023 a lawyer in the Southern District of New York filed a brief
 * citing six cases that did not exist. They had been produced by a chatbot,
 * and they were plausible: real reporters, real courts, years that fit. The
 * affirmation here is the document the court asked for afterwards, and it is
 * the reason a tool like this is worth having.
 *
 * It is published with the app so that the walkthrough has something concrete
 * to work on, and because it is a genuinely hard document: eleven pages, part
 * text and part scanned exhibit, so opening it exercises the PDF text layer
 * and the OCR path in one go.
 *
 * A public court filing, from the public docket.
 */

/** Served from the same origin. Nothing here reaches another host. */
export const EXAMPLE_FILE = "mata-v-avianca-filing.pdf";

export const EXAMPLE = {
  file: EXAMPLE_FILE,
  name: "Mata v. Avianca — affirmation in opposition",
  citation: "No. 1:22-cv-01461 (PKC) (S.D.N.Y. filed Mar. 1, 2023)",
  /** Roughly what to expect, so a slow OCR run does not look broken. */
  pages: 11,
  approximateSeconds: 40,
} as const;

/**
 * Fetch the example and hand it back as a `File`, so it goes through exactly
 * the same import path as a file the user drags in.
 *
 * Same-origin: this is the one request the application makes, and the page's
 * `connect-src 'self'` means the browser would refuse it if it were not.
 */
export async function loadExample(): Promise<File> {
  const url = new URL(EXAMPLE_FILE, document.baseURI).toString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Could not load the example filing (${response.status}). It is published ` +
        "with the app, so this usually means the page was opened from a copy " +
        "that does not include it.",
    );
  }
  return new File([await response.blob()], EXAMPLE_FILE, { type: "application/pdf" });
}
