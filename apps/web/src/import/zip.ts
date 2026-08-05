/**
 * Just enough ZIP to read one entry out of a `.docx` or `.odt`.
 *
 * Both formats are ZIP archives holding XML. Reading them needs an inflate,
 * and browsers have had one built in for years — `DecompressionStream`. Pulling
 * in a ZIP library to do what the platform already does would mean adding a
 * dependency to the one part of this project that has none, on the code path
 * that handles a client's document.
 *
 * This reads the central directory rather than scanning local headers, because
 * a local header may declare sizes of zero and defer them to a data descriptor
 * after the compressed data — which is exactly what streaming writers like Word
 * emit, and what makes naive readers truncate.
 */

/** ZIP is little-endian throughout. */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

export class ZipError extends Error {
  override readonly name = "ZipError";
}

interface Entry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

/**
 * Locate the end-of-central-directory record.
 *
 * It sits at the very end unless there is a ZIP comment, so the search runs
 * backwards over the last 64KB — the largest a comment can be.
 */
function findEndOfCentralDirectory(view: DataView): number {
  const maxComment = 0xffff;
  const earliest = Math.max(0, view.byteLength - maxComment - 22);

  for (let offset = view.byteLength - 22; offset >= earliest; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipError("Not a ZIP archive: no end-of-central-directory record.");
}

/** Every entry in the archive, by name. */
export function readCentralDirectory(buffer: ArrayBuffer): Map<string, Entry> {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder("utf-8");
  const entries = new Map<string, Entry>();

  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > view.byteLength ||
      view.getUint32(offset, true) !== CENTRAL_SIGNATURE
    ) {
      throw new ZipError(`Malformed central directory at entry ${i}.`);
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.set(name, { name, method, compressedSize, localHeaderOffset });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Inflate (or copy) the bytes of one entry and decode them as UTF-8. */
async function readEntry(buffer: ArrayBuffer, entry: Entry): Promise<string> {
  const view = new DataView(buffer);
  const local = entry.localHeaderOffset;

  if (view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new ZipError(`Malformed local header for ${entry.name}.`);
  }

  // The local header's own name and extra lengths are authoritative here; the
  // central directory's extra field is often a different length.
  const nameLength = view.getUint16(local + 26, true);
  const extraLength = view.getUint16(local + 28, true);
  const start = local + 30 + nameLength + extraLength;
  const bytes = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.method === STORED) return new TextDecoder("utf-8").decode(bytes);
  if (entry.method !== DEFLATED) {
    throw new ZipError(
      `${entry.name} uses compression method ${entry.method}, which ReCite cannot read. ` +
        "Re-save the document and try again.",
    );
  }

  // `deflate-raw` and not `deflate`: ZIP stores a bare deflate stream with no
  // zlib header, and using the wrong one fails on the first byte.
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));

  return new Response(stream).text();
}

/**
 * Read one named entry as text.
 *
 * Returns `undefined` when the archive does not contain it, so a caller can
 * tell "this is not the format I thought" from "this file is corrupt".
 */
export async function readZipText(
  buffer: ArrayBuffer,
  path: string,
): Promise<string | undefined> {
  const entries = readCentralDirectory(buffer);
  const entry = entries.get(path);
  if (!entry) return undefined;
  return readEntry(buffer, entry);
}

/** Whether the buffer starts with a local file header. */
export function looksLikeZip(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  return new DataView(buffer).getUint32(0, true) === LOCAL_SIGNATURE;
}
