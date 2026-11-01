import { createHash } from 'node:crypto';
import { crc32, deflateRawSync, zstdCompressSync } from 'node:zlib';

const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATED = 8;
const COMPRESSION_ZSTD = 93;
const DATA_DESCRIPTOR_FLAG = 0x08;
const INDEX_FILENAME = '@3dtilesIndex1@';
const UINT32_SENTINEL = 0xffffffff;
const ZIP_VERSION = 20;
const ZIP64_VERSION = 45;

const LOCAL_HEADER = {
  signature: 0x04034b50,
  length: 30,
  versionOffset: 4,
  flagsOffset: 6,
  methodOffset: 8,
  crcOffset: 14,
  compressedSizeOffset: 18,
  sizeOffset: 22,
  nameLengthOffset: 26,
} as const;

const CENTRAL_HEADER = {
  signature: 0x02014b50,
  length: 46,
  versionMadeByOffset: 4,
  versionOffset: 6,
  flagsOffset: 8,
  methodOffset: 10,
  crcOffset: 16,
  compressedSizeOffset: 20,
  sizeOffset: 24,
  nameLengthOffset: 28,
  extraLengthOffset: 30,
  localHeaderOffset: 42,
} as const;

const END_OF_CENTRAL_DIRECTORY = {
  signature: 0x06054b50,
  length: 22,
  diskEntriesOffset: 8,
  totalEntriesOffset: 10,
  sizeOffset: 12,
  startOffset: 16,
} as const;

const ZIP64_EXTRA = {
  tag: 0x0001,
  sizeOffset: 2,
  valueOffset: 4,
  valueLength: 8,
} as const;

const INDEX_ENTRY = {
  hashHalfLength: 8,
  offsetLength: 8,
} as const;

interface ArchiveEntry {
  name: string;
  content: string | Buffer;
  method?: number;
  flags?: number;
  data?: Buffer;
}

interface IndexOverride {
  name: string;
  offsetOf?: string;
  offset?: number;
}

interface ArchiveOptions {
  withIndex?: boolean;
  indexMethod?: number;
  indexFirst?: boolean;
  indexOverrides?: IndexOverride[];
  zip64IndexOffset?: boolean;
}

const compress = (method: number, content: Buffer): Buffer => {
  if (method === COMPRESSION_DEFLATED) {
    return deflateRawSync(content);
  }
  if (method === COMPRESSION_ZSTD) {
    return zstdCompressSync(content);
  }
  return content;
};

const md5 = (name: string): Buffer => createHash('md5').update(name).digest();

const compareHashes = (hashA: Buffer, hashB: Buffer): number => {
  const firstA = hashA.readBigUInt64LE(0);
  const firstB = hashB.readBigUInt64LE(0);
  const [valueA, valueB] =
    firstA !== firstB ? [firstA, firstB] : [hashA.readBigUInt64LE(INDEX_ENTRY.hashHalfLength), hashB.readBigUInt64LE(INDEX_ENTRY.hashHalfLength)];
  return Number(valueA > valueB) - Number(valueA < valueB);
};

const buildArchive = (entries: ArchiveEntry[], options: ArchiveOptions = {}): Buffer => {
  const { withIndex = true, indexMethod = COMPRESSION_STORED, indexFirst = false, indexOverrides, zip64IndexOffset = false } = options;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const offsets = new Map<string, number>();
  let position = 0;

  const addEntry = ({ name, content, method = COMPRESSION_STORED, flags = 0, data }: ArchiveEntry, isZip64Offset = false): void => {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    const body = data ?? compress(method, raw);
    const nameBuffer = Buffer.from(name, 'utf-8');

    const local = Buffer.alloc(LOCAL_HEADER.length);
    local.writeUInt32LE(LOCAL_HEADER.signature, 0);
    local.writeUInt16LE(ZIP_VERSION, LOCAL_HEADER.versionOffset);
    local.writeUInt16LE(flags, LOCAL_HEADER.flagsOffset);
    local.writeUInt16LE(method, LOCAL_HEADER.methodOffset);
    local.writeUInt32LE(crc32(raw), LOCAL_HEADER.crcOffset);
    local.writeUInt32LE(body.length, LOCAL_HEADER.compressedSizeOffset);
    local.writeUInt32LE(raw.length, LOCAL_HEADER.sizeOffset);
    local.writeUInt16LE(nameBuffer.length, LOCAL_HEADER.nameLengthOffset);
    locals.push(local, nameBuffer, body);
    offsets.set(name, position);

    const extra = Buffer.alloc(isZip64Offset ? ZIP64_EXTRA.valueOffset + ZIP64_EXTRA.valueLength : 0);
    if (isZip64Offset) {
      extra.writeUInt16LE(ZIP64_EXTRA.tag, 0);
      extra.writeUInt16LE(ZIP64_EXTRA.valueLength, ZIP64_EXTRA.sizeOffset);
      extra.writeBigUInt64LE(BigInt(position), ZIP64_EXTRA.valueOffset);
    }

    const central = Buffer.alloc(CENTRAL_HEADER.length);
    central.writeUInt32LE(CENTRAL_HEADER.signature, 0);
    central.writeUInt16LE(ZIP64_VERSION, CENTRAL_HEADER.versionMadeByOffset);
    central.writeUInt16LE(ZIP_VERSION, CENTRAL_HEADER.versionOffset);
    central.writeUInt16LE(flags, CENTRAL_HEADER.flagsOffset);
    central.writeUInt16LE(method, CENTRAL_HEADER.methodOffset);
    central.writeUInt32LE(crc32(raw), CENTRAL_HEADER.crcOffset);
    central.writeUInt32LE(body.length, CENTRAL_HEADER.compressedSizeOffset);
    central.writeUInt32LE(raw.length, CENTRAL_HEADER.sizeOffset);
    central.writeUInt16LE(nameBuffer.length, CENTRAL_HEADER.nameLengthOffset);
    central.writeUInt16LE(extra.length, CENTRAL_HEADER.extraLengthOffset);
    central.writeUInt32LE(isZip64Offset ? UINT32_SENTINEL : position, CENTRAL_HEADER.localHeaderOffset);
    centrals.push(Buffer.concat([central, nameBuffer, extra]));

    position += local.length + nameBuffer.length + body.length;
  };

  const addIndex = (): void => {
    const targets: IndexOverride[] = indexOverrides ?? entries.map(({ name }) => ({ name, offsetOf: name }));
    const index = targets
      .map(({ name, offsetOf, offset }) => ({ hash: md5(name), offset: offset ?? offsets.get(offsetOf ?? name) ?? 0 }))
      .sort((entryA, entryB) => compareHashes(entryA.hash, entryB.hash))
      .map(({ hash, offset }) => {
        const offsetBuffer = Buffer.alloc(INDEX_ENTRY.offsetLength);
        offsetBuffer.writeBigUInt64LE(BigInt(offset));
        return Buffer.concat([hash, offsetBuffer]);
      });
    addEntry({ name: INDEX_FILENAME, content: Buffer.concat(index), method: indexMethod }, zip64IndexOffset);
  };

  if (withIndex && indexFirst) {
    addIndex();
  }
  entries.forEach((entry) => addEntry(entry));
  if (withIndex && !indexFirst) {
    addIndex();
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY.length);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY.signature, 0);
  end.writeUInt16LE(centrals.length, END_OF_CENTRAL_DIRECTORY.diskEntriesOffset);
  end.writeUInt16LE(centrals.length, END_OF_CENTRAL_DIRECTORY.totalEntriesOffset);
  end.writeUInt32LE(centralDirectory.length, END_OF_CENTRAL_DIRECTORY.sizeOffset);
  end.writeUInt32LE(position, END_OF_CENTRAL_DIRECTORY.startOffset);
  return Buffer.concat([...locals, centralDirectory, end]);
};

export { buildArchive, COMPRESSION_DEFLATED, COMPRESSION_STORED, COMPRESSION_ZSTD, DATA_DESCRIPTOR_FLAG };
export type { ArchiveEntry };
