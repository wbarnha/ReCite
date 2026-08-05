/**
 * Writing a ZIP, for `.docx` and `.odt` export.
 *
 * The mirror of `import/zip.ts`, and dependency-free for the same reason: the
 * browser has a deflate built in (`CompressionStream`), so taking a ZIP
 * library would mean adding a dependency to the code path that handles a
 * client's document.
 *
 * ZIP needs a CRC-32 of the uncompressed bytes in both the local and central
 * headers, and unlike the reader — which can ignore a checksum it is not
 * verifying — a writer cannot skip it. Word refuses an archive whose CRCs are
 * wrong, so the table below is not optional.
 */

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const DEFLATED = 8;
const STORED = 0;

/** CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: string | Uint8Array;
  /**
   * Store without compressing.
   *
   * ODF requires the `mimetype` entry to be first and uncompressed; an
   * archive that deflates it is not a valid OpenDocument file even though
   * every ZIP tool will happily open it.
   */
  readonly store?: boolean;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Build a ZIP archive. */
export async function writeZip(entries: readonly ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw =
      typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const checksum = crc32(raw);

    const stored = entry.store === true;
    const body = stored ? raw : await deflate(raw);
    const method = stored ? STORED : DEFLATED;

    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, LOCAL_SIGNATURE, true);
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, method, true);
    local.setUint16(10, 0, true); // time
    local.setUint16(12, 0x21, true); // date: 1 Jan 1996, fixed for reproducibility
    local.setUint32(14, checksum, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra length
    const localBytes = new Uint8Array(local.buffer);
    localBytes.set(name, 30);

    const central = new DataView(new ArrayBuffer(46 + name.length));
    central.setUint32(0, CENTRAL_SIGNATURE, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(10, method, true);
    central.setUint16(14, 0x21, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    const centralBytes = new Uint8Array(central.buffer);
    centralBytes.set(name, 46);

    locals.push(localBytes, body);
    centrals.push(centralBytes);
    offset += localBytes.length + body.length;
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, EOCD_SIGNATURE, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);

  return new Blob([...locals, ...centrals, new Uint8Array(eocd.buffer)] as BlobPart[], {
    type: "application/zip",
  });
}
