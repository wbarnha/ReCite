/**
 * Build a genuinely scanned PDF: one page, one JPEG, no text layer.
 *
 * The OCR path cannot be tested with a normal PDF, because a normal PDF has a
 * text layer and Scribe reads it directly — which is the whole point of
 * `autoShallow`. To exercise OCR the fixture has to be what a scanner
 * produces: a picture of words, with nothing selectable in it.
 *
 * So the text is rendered in Chromium, screenshotted as a JPEG, and wrapped in
 * a minimal PDF by hand. Written out rather than pulled from a library because
 * a PDF containing a single `DCTDecode` image is about forty lines, and the
 * alternative is a dependency that exists only for one test.
 */

import type { Browser } from "playwright";

/** Render text as a JPEG that looks like a page off a scanner. */
export async function renderTextAsJpeg(
  browser: Browser,
  lines: readonly string[],
): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });

  // Serif, generous size and spacing: this has to be legible to OCR, and a
  // test that fails because the fixture was unreadable teaches nothing about
  // the code.
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>
       body { margin: 90px 80px; background: #fff; }
       p {
         font: 30px/1.9 "Times New Roman", Times, Georgia, serif;
         color: #000;
         margin: 0 0 22px;
       }
     </style>
     ${lines.map((line) => `<p>${line}</p>`).join("")}`,
  );

  const jpeg = await page.screenshot({ type: "jpeg", quality: 92, fullPage: false });
  await page.close();
  return Buffer.from(jpeg);
}

/** Read width and height out of a JPEG's SOF marker. */
function jpegSize(jpeg: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = jpeg[offset + 1]!;
    // SOF0..SOF3 and SOF5..SOF15 carry the dimensions; skip SOF4 (DHT) and
    // the restart markers.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: jpeg.readUInt16BE(offset + 5),
        width: jpeg.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }
  throw new Error("Could not read the JPEG dimensions.");
}

/**
 * Wrap a JPEG in a one-page PDF.
 *
 * The image is embedded with `DCTDecode`, which means the JPEG bytes are
 * stored as-is — no re-encoding, and no text anywhere in the file.
 */
export function jpegToPdf(jpeg: Buffer): Buffer {
  const { width, height } = jpegSize(jpeg);

  // US Letter at 72dpi, with the image scaled to fill it.
  const pageWidth = 612;
  const pageHeight = Math.round((height / width) * pageWidth);

  const objects: Buffer[] = [];
  const add = (body: string | Buffer) =>
    objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);

  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  add(
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
          `/Length ${jpeg.length} >>\nstream\n`,
        "latin1",
      ),
      jpeg,
      Buffer.from("\nendstream", "latin1"),
    ]),
  );

  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  // --- assemble, recording byte offsets for the cross-reference table ---
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  });

  const xrefStart = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  ].join("");

  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

/** A scanned PDF of the given lines. */
export async function makeScannedPdf(
  browser: Browser,
  lines: readonly string[],
): Promise<Buffer> {
  return jpegToPdf(await renderTextAsJpeg(browser, lines));
}
