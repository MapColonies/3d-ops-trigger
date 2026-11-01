// Reads one file from a .3tz without unpacking it, via the @3dtilesIndex1@ index (https://github.com/erikdahlstrom/3tz-specification)
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { inflateRawSync, zstdDecompressSync } from 'node:zlib';
import {
  ERROR_3TZ_INVALID,
  ERROR_3TZ_NO_INDEX,
  ERROR_3TZ_UNSUPPORTED_COMPRESSION,
  ERROR_3TZ_UNSUPPORTED_ENCODING,
  ERROR_TILESET_NOT_IN_ARCHIVE,
} from './constants';

const INDEX_FILENAME = '@3dtilesIndex1@';

const LOCAL_HEADER = {
  signature: 0x04034b50,
  length: 30,
  flagsOffset: 6,
  methodOffset: 8,
  compressedSizeOffset: 18,
  nameLengthOffset: 26,
  extraLengthOffset: 28,
} as const;

const CENTRAL_HEADER = {
  signature: 0x02014b50,
  length: 46,
  methodOffset: 10,
  compressedSizeOffset: 20,
  sizeOffset: 24,
  nameLengthOffset: 28,
  extraLengthOffset: 30,
  localHeaderOffset: 42,
} as const;

const EXTRA_FIELD = {
  headerLength: 4,
  sizeOffset: 2,
  zip64Tag: 0x0001,
  zip64ValueLength: 8,
} as const;

const INDEX_ENTRY = {
  length: 24,
  hashLength: 16,
  hashHalfLength: 8,
} as const;

const COMPRESSION = {
  stored: 0,
  deflated: 8,
  zstd: 93,
} as const;

const MAX_TAIL_LENGTH = 66_560;
const UINT32_SENTINEL = 0xffffffff;
const DATA_DESCRIPTOR_FLAG = 0x08;
const NOT_FOUND = -1;

class Archive3tzError extends Error {}

const readBytes = async (handle: FileHandle, length: number, position: number): Promise<Buffer> => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new Archive3tzError(ERROR_3TZ_INVALID);
  }
  return buffer;
};

const readZip64Values = (extra: Buffer, count: number): number[] => {
  let position = 0;
  while (position + EXTRA_FIELD.headerLength <= extra.length) {
    const tag = extra.readUInt16LE(position);
    const size = extra.readUInt16LE(position + EXTRA_FIELD.sizeOffset);
    const valuesStart = position + EXTRA_FIELD.headerLength;
    if (tag === EXTRA_FIELD.zip64Tag) {
      if (size < count * EXTRA_FIELD.zip64ValueLength || valuesStart + size > extra.length) {
        throw new Archive3tzError(ERROR_3TZ_INVALID);
      }
      return Array.from({ length: count }, (_, value) => Number(extra.readBigUInt64LE(valuesStart + value * EXTRA_FIELD.zip64ValueLength)));
    }
    position = valuesStart + size;
  }
  throw new Archive3tzError(ERROR_3TZ_INVALID);
};

const findLastCentralHeader = (tail: Buffer): number => {
  for (let position = tail.length - CENTRAL_HEADER.length; position >= 0; position--) {
    if (tail.readUInt32LE(position) === CENTRAL_HEADER.signature) {
      return position;
    }
  }
  return NOT_FOUND;
};

const findIndexOffset = async (handle: FileHandle): Promise<number> => {
  const { size } = await handle.stat();
  const tailLength = Math.min(size, MAX_TAIL_LENGTH);
  const tail = await readBytes(handle, tailLength, size - tailLength);

  const start = findLastCentralHeader(tail);
  if (start === NOT_FOUND) {
    throw new Archive3tzError(ERROR_3TZ_NO_INDEX);
  }

  const method = tail.readUInt16LE(start + CENTRAL_HEADER.methodOffset);
  const compressedSize = tail.readUInt32LE(start + CENTRAL_HEADER.compressedSizeOffset);
  const uncompressedSize = tail.readUInt32LE(start + CENTRAL_HEADER.sizeOffset);
  const nameLength = tail.readUInt16LE(start + CENTRAL_HEADER.nameLengthOffset);
  const extraLength = tail.readUInt16LE(start + CENTRAL_HEADER.extraLengthOffset);
  const offset = tail.readUInt32LE(start + CENTRAL_HEADER.localHeaderOffset);
  const nameStart = start + CENTRAL_HEADER.length;
  const extraStart = nameStart + nameLength;
  if (extraStart + extraLength > tail.length) {
    throw new Archive3tzError(ERROR_3TZ_INVALID);
  }

  const name = tail.toString('utf-8', nameStart, extraStart);
  if (name !== INDEX_FILENAME || method !== COMPRESSION.stored) {
    throw new Archive3tzError(ERROR_3TZ_NO_INDEX);
  }
  if (offset !== UINT32_SENTINEL) {
    return offset;
  }

  const count = [uncompressedSize, compressedSize, offset].filter((value) => value === UINT32_SENTINEL).length;
  const values = readZip64Values(tail.subarray(extraStart, extraStart + extraLength), count);
  return values[values.length - 1] as number;
};

const readEntry = async (handle: FileHandle, offset: number, expectedName: string): Promise<{ method: number; data: Buffer } | undefined> => {
  const header = await readBytes(handle, LOCAL_HEADER.length, offset);
  if (header.readUInt32LE(0) !== LOCAL_HEADER.signature) {
    throw new Archive3tzError(ERROR_3TZ_INVALID);
  }

  const flags = header.readUInt16LE(LOCAL_HEADER.flagsOffset);
  const method = header.readUInt16LE(LOCAL_HEADER.methodOffset);
  const compressedSize = header.readUInt32LE(LOCAL_HEADER.compressedSizeOffset);
  const nameLength = header.readUInt16LE(LOCAL_HEADER.nameLengthOffset);
  const extraLength = header.readUInt16LE(LOCAL_HEADER.extraLengthOffset);

  const name = (await readBytes(handle, nameLength, offset + LOCAL_HEADER.length)).toString('utf-8');
  if (name !== expectedName) {
    return undefined;
  }
  if ((flags & DATA_DESCRIPTOR_FLAG) !== 0 || compressedSize === 0 || compressedSize === UINT32_SENTINEL) {
    throw new Archive3tzError(ERROR_3TZ_UNSUPPORTED_ENCODING);
  }

  const data = await readBytes(handle, compressedSize, offset + LOCAL_HEADER.length + nameLength + extraLength);
  return { method, data };
};

const compareHashes = (hashA: Buffer, hashB: Buffer): number => {
  const firstA = hashA.readBigUInt64LE(0);
  const firstB = hashB.readBigUInt64LE(0);
  const [valueA, valueB] =
    firstA !== firstB ? [firstA, firstB] : [hashA.readBigUInt64LE(INDEX_ENTRY.hashHalfLength), hashB.readBigUInt64LE(INDEX_ENTRY.hashHalfLength)];
  return Number(valueA > valueB) - Number(valueA < valueB);
};

const findCandidateOffsets = (index: Buffer, hash: Buffer): number[] => {
  const entries = index.length / INDEX_ENTRY.length;
  const hashAt = (entry: number): Buffer => index.subarray(entry * INDEX_ENTRY.length, entry * INDEX_ENTRY.length + INDEX_ENTRY.hashLength);
  const offsetAt = (entry: number): number => Number(index.readBigUInt64LE(entry * INDEX_ENTRY.length + INDEX_ENTRY.hashLength));

  let low = 0;
  let high = entries - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const comparison = compareHashes(hashAt(middle), hash);
    if (comparison === 0) {
      let first = middle;
      while (first > 0 && compareHashes(hashAt(first - 1), hash) === 0) {
        first--;
      }
      const offsets: number[] = [];
      for (let entry = first; entry < entries && compareHashes(hashAt(entry), hash) === 0; entry++) {
        offsets.push(offsetAt(entry));
      }
      return offsets;
    }
    if (comparison < 0) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return [];
};

const decompress = (method: number, data: Buffer): Buffer => {
  switch (method) {
    case COMPRESSION.stored:
      return data;
    case COMPRESSION.deflated:
      return inflateRawSync(data);
    case COMPRESSION.zstd:
      return zstdDecompressSync(data);
    default:
      throw new Archive3tzError(ERROR_3TZ_UNSUPPORTED_COMPRESSION);
  }
};

const readArchiveFile = async (archivePath: string, fileName: string): Promise<Buffer> => {
  let handle: FileHandle | undefined;
  try {
    handle = await open(archivePath, 'r');
    const indexEntry = await readEntry(handle, await findIndexOffset(handle), INDEX_FILENAME);
    if (indexEntry === undefined || indexEntry.data.length % INDEX_ENTRY.length !== 0) {
      throw new Archive3tzError(ERROR_3TZ_NO_INDEX);
    }

    const hash = createHash('md5').update(fileName).digest();
    for (const offset of findCandidateOffsets(indexEntry.data, hash)) {
      const entry = await readEntry(handle, offset, fileName);
      if (entry !== undefined) {
        return decompress(entry.method, entry.data);
      }
    }
    throw new Archive3tzError(ERROR_TILESET_NOT_IN_ARCHIVE);
  } catch (err) {
    if (err instanceof Archive3tzError) {
      throw err;
    }
    throw new Archive3tzError(ERROR_3TZ_INVALID, { cause: err });
  } finally {
    await handle?.close();
  }
};

export { Archive3tzError, readArchiveFile };
