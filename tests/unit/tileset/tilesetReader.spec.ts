import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { describe, it, expect, beforeEach } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import {
  TilesetReader,
  ERROR_TILESET_NOT_FIRST_ENTRY,
  ERROR_TILESET_READ_FAILED,
  ERROR_TILESET_UNSUPPORTED_ENCODING,
} from '@src/tileset/tilesetReader';
import { AppError } from '@src/common/appError';

const fixtures = join(__dirname, '../../helpers/tilesets');

const buildLocalHeader = (name: string, flags: number): Buffer => {
  const nameBuffer = Buffer.from(name, 'utf-8');
  const header = Buffer.alloc(30 + nameBuffer.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(flags, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 18);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  nameBuffer.copy(header, 30);
  return header;
};

describe('TilesetReader', function () {
  let reader: TilesetReader;

  beforeEach(async function () {
    reader = new TilesetReader(await jsLogger({ enabled: false }));
  });

  it('should read tileset.json from the first entry of a 3tz archive.', async function () {
    const content = await reader.readTilesetJson(join(fixtures, 'region.3tz'), 'tileset.json');
    const parsed = JSON.parse(content) as { root: { boundingVolume: { region?: number[] } } };

    expect(parsed.root.boundingVolume.region).toBeDefined();
  });

  it('should read tileset.json from a folder input.', async function () {
    const content = await reader.readTilesetJson(join(fixtures, 'folder'), 'tileset.json');
    const parsed = JSON.parse(content) as { root: { boundingVolume: { region?: number[] } } };

    expect(parsed.root.boundingVolume.region).toBeDefined();
  });

  it('should throw a 400 when the requested entry is not the first entry of the archive.', async function () {
    await expect(reader.readTilesetJson(join(fixtures, 'region.3tz'), 'other.json')).rejects.toThrow(ERROR_TILESET_NOT_FIRST_ENTRY);
  });

  it('should throw a 400 when the archive entry uses a data descriptor (size absent from local header).', async function () {
    const dir = await mkdtemp(join(tmpdir(), 'tileset-reader-'));
    const archive = join(dir, 'descriptor.3tz');
    await writeFile(archive, buildLocalHeader('tileset.json', 0x08));

    try {
      await expect(reader.readTilesetJson(archive, 'tileset.json')).rejects.toThrow(ERROR_TILESET_UNSUPPORTED_ENCODING);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should throw when the folder tileset file is missing.', async function () {
    let thrown: unknown;
    try {
      await reader.readTilesetJson(join(fixtures, 'folder'), 'missing.json');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).message).toBe(ERROR_TILESET_READ_FAILED);
  });
});
