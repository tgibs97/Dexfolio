const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = createCrcTable();

export interface ZipSource {
  name: string;
  data: Uint8Array | ReadableStream<Uint8Array> | (() => Promise<Uint8Array | ReadableStream<Uint8Array>>);
}

export class ZipFormatError extends Error {}

/** Streams a store-only ZIP, avoiding buffering every R2 image in Worker memory. */
export function createZipStream(sources: ZipSource[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      let offset = 0;
      const centralEntries: CentralEntry[] = [];
      try {
        for (const source of sources) {
          const name = textEncoder.encode(source.name);
          if (!isSafePath(source.name) || name.length > 65_535) throw new ZipFormatError('Invalid archive path.');
          const localOffset = offset;
          const { dosDate, dosTime } = dosTimestamp(new Date());
          const localHeader = new Uint8Array(30 + name.length);
          const local = new DataView(localHeader.buffer);
          local.setUint32(0, 0x04034b50, true);
          local.setUint16(4, 20, true);
          local.setUint16(6, 0x0808, true); // UTF-8 names and a trailing data descriptor.
          local.setUint16(8, 0, true);
          local.setUint16(10, dosTime, true);
          local.setUint16(12, dosDate, true);
          local.setUint16(26, name.length, true);
          localHeader.set(name, 30);
          controller.enqueue(localHeader);
          offset += localHeader.length;

          const sourceData = typeof source.data === 'function' ? await source.data() : source.data;
          let crc = 0xffffffff;
          let size = 0;
          if (sourceData instanceof Uint8Array) {
            crc = updateCrc(crc, sourceData);
            size = sourceData.length;
            controller.enqueue(sourceData);
          } else {
            const reader = sourceData.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              crc = updateCrc(crc, value);
              size += value.length;
              controller.enqueue(value);
            }
          }
          if (size > 0xffffffff) throw new ZipFormatError('Archive entries must be smaller than 4 GB.');
          offset += size;
          crc = (crc ^ 0xffffffff) >>> 0;

          const descriptor = new Uint8Array(16);
          const descriptorView = new DataView(descriptor.buffer);
          descriptorView.setUint32(0, 0x08074b50, true);
          descriptorView.setUint32(4, crc, true);
          descriptorView.setUint32(8, size, true);
          descriptorView.setUint32(12, size, true);
          controller.enqueue(descriptor);
          offset += descriptor.length;
          centralEntries.push({ name, crc, size, offset: localOffset, dosDate, dosTime });
        }

        if (centralEntries.length > 65_535 || offset > 0xffffffff)
          throw new ZipFormatError('The backup is too large for this archive format.');
        const centralOffset = offset;
        for (const entry of centralEntries) {
          const header = centralHeader(entry);
          controller.enqueue(header);
          offset += header.length;
        }
        const centralSize = offset - centralOffset;
        const end = new Uint8Array(22);
        const endView = new DataView(end.buffer);
        endView.setUint32(0, 0x06054b50, true);
        endView.setUint16(8, centralEntries.length, true);
        endView.setUint16(10, centralEntries.length, true);
        endView.setUint32(12, centralSize, true);
        endView.setUint32(16, centralOffset, true);
        controller.enqueue(end);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/** Reads store-only ZIPs produced by this app and validates paths, sizes, and CRCs. */
export function readStoredZip(buffer: ArrayBuffer, maximumBytes: number): Map<string, Uint8Array> {
  if (buffer.byteLength > maximumBytes) throw new ZipFormatError('The backup archive is too large.');
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const endOffset = findEndRecord(view);
  const entries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (view.getUint16(endOffset + 4, true) !== 0 || view.getUint16(endOffset + 6, true) !== 0)
    throw new ZipFormatError('Multi-disk ZIP backups are not supported.');
  if (view.getUint16(endOffset + 8, true) !== entries || centralOffset + centralSize > endOffset)
    throw new ZipFormatError('The ZIP directory is invalid.');

  const files = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entries; index += 1) {
    requireRange(bytes, cursor, 46);
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new ZipFormatError('The ZIP directory is invalid.');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    requireRange(bytes, cursor + 46, nameLength + extraLength + commentLength);
    const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!isSafePath(name) || files.has(name)) throw new ZipFormatError('The ZIP contains an invalid path.');
    if ((flags & 1) !== 0 || method !== 0 || compressedSize !== size)
      throw new ZipFormatError('Only unencrypted Dexfolio ZIP backups are supported.');
    expandedBytes += size;
    if (expandedBytes > maximumBytes) throw new ZipFormatError('The expanded backup archive is too large.');

    requireRange(bytes, localOffset, 30);
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new ZipFormatError('A ZIP entry is invalid.');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    requireRange(bytes, dataOffset, size);
    const data = bytes.subarray(dataOffset, dataOffset + size);
    if (crc32(data) !== expectedCrc) throw new ZipFormatError(`The ZIP entry ${name} is corrupted.`);
    files.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) throw new ZipFormatError('The ZIP directory size is invalid.');
  return files;
}

function centralHeader(entry: CentralEntry): Uint8Array {
  const header = new Uint8Array(46 + entry.name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0808, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint32(42, entry.offset, true);
  header.set(entry.name, 46);
  return header;
}

function findEndRecord(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  throw new ZipFormatError('The selected file is not a valid ZIP backup.');
}

function requireRange(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > bytes.length) throw new ZipFormatError('The ZIP is truncated.');
}

function decodeName(bytes: Uint8Array): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new ZipFormatError('The ZIP contains an invalid filename.');
  }
}

function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..')
  );
}

function crc32(bytes: Uint8Array): number {
  return (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

function updateCrc(initial: number, bytes: Uint8Array): number {
  let crc = initial;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc;
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1) >>> 0;
    table[index] = value;
  }
  return table;
}

function dosTimestamp(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    dosDate: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    dosTime: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
  };
}

interface CentralEntry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  dosDate: number;
  dosTime: number;
}
