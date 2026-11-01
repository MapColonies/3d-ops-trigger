import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bbox } from '@turf/turf';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppError, ERROR_BAD_FORMAT_TILESET, ERROR_BOX_TILESET } from '@map-colonies/3d-shared';
import { TilesetReader } from '@src/extractor/tilesetReader';
import {
  ERROR_3TZ_INVALID,
  ERROR_3TZ_NO_INDEX,
  ERROR_3TZ_UNSUPPORTED_COMPRESSION,
  ERROR_3TZ_UNSUPPORTED_ENCODING,
  ERROR_TILESET_INVALID,
  ERROR_TILESET_NOT_IN_ARCHIVE,
} from '@src/extractor/constants';
import {
  buildArchive,
  COMPRESSION_DEFLATED,
  COMPRESSION_STORED,
  COMPRESSION_ZSTD,
  DATA_DESCRIPTOR_FLAG,
  type ArchiveEntry,
} from '@tests/helpers/archive3tz';

const FIXTURE_DATA = join(__dirname, '../../fixtures/ingestion/paris/data');
const PARIS_BBOX = [2.33, 48.85, 2.35, 48.87];
const COMPRESSION_BZIP2 = 12;

const tilesetWith = (boundingVolume: unknown): string => JSON.stringify({ asset: { version: '1.0' }, root: { boundingVolume, geometricError: 1 } });
const validTileset = tilesetWith({ region: [0.04, 0.85, 0.041, 0.851, 0, 10] });
const tile: ArchiveEntry = { name: 'tiles/0.b3dm', content: 'b3dm', method: COMPRESSION_DEFLATED };

describe('TilesetReader', function () {
  let reader: TilesetReader;
  let folder: string;

  const write = async (fileName: string, content: string | Buffer): Promise<string> => {
    const path = join(folder, fileName);
    await writeFile(path, content);
    return path;
  };

  beforeEach(async function () {
    reader = new TilesetReader(await jsLogger({ enabled: false }));
    folder = await mkdtemp(join(tmpdir(), 'ops-trigger-tileset-'));
  });

  afterEach(async function () {
    await rm(folder, { recursive: true, force: true });
  });

  it.each(['tileset.json', 'model.3tz'])('should read the model polygon of the fixture %s', async function (fileName) {
    const polygon = await reader.readModelPolygon(join(FIXTURE_DATA, fileName));

    bbox(polygon).forEach((value, index) => expect(value).toBeCloseTo(PARIS_BBOX[index] as number, 5));
  });

  it.each([
    ['stored', COMPRESSION_STORED],
    ['deflate', COMPRESSION_DEFLATED],
    ['zstd', COMPRESSION_ZSTD],
  ])('should read a %s tileset entry from a .3tz', async function (_case, method) {
    const archive = buildArchive([tile, { name: 'tileset.json', content: validTileset, method }]);

    await expect(reader.readModelPolygon(await write('model.3tz', archive))).resolves.toMatchObject({ type: 'Polygon' });
  });

  it('should find the tileset through the index when the index offset is stored as ZIP64', async function () {
    const archive = buildArchive([{ name: 'tileset.json', content: validTileset }, tile], { zip64IndexOffset: true });

    await expect(reader.readModelPolygon(await write('model.3tz', archive))).resolves.toMatchObject({ type: 'Polygon' });
  });

  it('should skip an index hash collision and use the entry whose name matches', async function () {
    const archive = buildArchive([tile, { name: 'tileset.json', content: validTileset }], {
      indexOverrides: [
        { name: 'tileset.json', offsetOf: 'tiles/0.b3dm' },
        { name: 'tileset.json', offsetOf: 'tileset.json' },
      ],
    });

    await expect(reader.readModelPolygon(await write('model.3tz', archive))).resolves.toMatchObject({ type: 'Polygon' });
  });

  it('should read the model polygon of a sphere bounding volume', async function () {
    const path = await write('tileset.json', tilesetWith({ sphere: [4201000, 171000, 4780000, 100] }));

    await expect(reader.readModelPolygon(path)).resolves.toMatchObject({ type: 'Polygon' });
  });

  it.each([
    ['not json', 'not json'],
    ['missing asset', JSON.stringify({ root: { boundingVolume: { region: [0, 0, 1, 1, 0, 1] } } })],
    ['missing root', JSON.stringify({ asset: { version: '1.0' } })],
    ['null root', JSON.stringify({ asset: { version: '1.0' }, root: null })],
    ['missing bounding volume', JSON.stringify({ asset: { version: '1.0' }, root: {} })],
    ['null bounding volume', tilesetWith(null)],
    ['null tileset', 'null'],
  ])('should reject an invalid tileset json (%s)', async function (_case, content) {
    const promise = reader.readModelPolygon(await write('tileset.json', content));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(ERROR_TILESET_INVALID);
  });

  it.each([
    ['a box', { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }, ERROR_BOX_TILESET],
    ['an unknown', { other: [1] }, ERROR_BAD_FORMAT_TILESET],
    ['a broken region', { region: 'not an array' }, ERROR_TILESET_INVALID],
  ])('should reject %s bounding volume', async function (_case, boundingVolume, message) {
    await expect(reader.readModelPolygon(await write('tileset.json', tilesetWith(boundingVolume)))).rejects.toThrow(message);
  });

  it('should reject a missing tileset file', async function () {
    await expect(reader.readModelPolygon(join(folder, 'tileset.json'))).rejects.toThrow('tileset.json: tileset is unreadable');
  });

  it.each([
    ['is not a zip archive', Buffer.from('definitely not a zip'), ERROR_3TZ_NO_INDEX],
    ['is empty', Buffer.alloc(0), ERROR_3TZ_NO_INDEX],
    ['has no index', buildArchive([{ name: 'tileset.json', content: validTileset }], { withIndex: false }), ERROR_3TZ_NO_INDEX],
    ['does not end with the index', buildArchive([{ name: 'tileset.json', content: validTileset }], { indexFirst: true }), ERROR_3TZ_NO_INDEX],
    [
      'has a compressed index',
      buildArchive([{ name: 'tileset.json', content: validTileset }], { indexMethod: COMPRESSION_DEFLATED }),
      ERROR_3TZ_NO_INDEX,
    ],
    ['has no tileset.json', buildArchive([tile]), ERROR_TILESET_NOT_IN_ARCHIVE],
    ['has the tileset.json only in a sub folder', buildArchive([{ name: 'data/tileset.json', content: validTileset }]), ERROR_TILESET_NOT_IN_ARCHIVE],
    [
      'indexes the tileset.json to a wrong entry',
      buildArchive([tile, { name: 'tileset.json', content: validTileset }], { indexOverrides: [{ name: 'tileset.json', offsetOf: 'tiles/0.b3dm' }] }),
      ERROR_TILESET_NOT_IN_ARCHIVE,
    ],
    [
      'uses a data descriptor',
      buildArchive([{ name: 'tileset.json', content: validTileset, flags: DATA_DESCRIPTOR_FLAG }]),
      ERROR_3TZ_UNSUPPORTED_ENCODING,
    ],
    ['has an empty tileset entry', buildArchive([{ name: 'tileset.json', content: '' }]), ERROR_3TZ_UNSUPPORTED_ENCODING],
    [
      'uses an unsupported compression',
      buildArchive([{ name: 'tileset.json', content: validTileset, method: COMPRESSION_BZIP2 }]),
      ERROR_3TZ_UNSUPPORTED_COMPRESSION,
    ],
    [
      'has a corrupted compressed entry',
      buildArchive([{ name: 'tileset.json', content: validTileset, method: COMPRESSION_DEFLATED, data: Buffer.from('not deflated') }]),
      ERROR_3TZ_INVALID,
    ],
    [
      'points the index at a missing offset',
      buildArchive([{ name: 'tileset.json', content: validTileset }], { indexOverrides: [{ name: 'tileset.json', offset: 999_999 }] }),
      ERROR_3TZ_INVALID,
    ],
  ])('should reject a .3tz that %s', async function (_case, archive, message) {
    const promise = reader.readModelPolygon(await write('model.3tz', archive));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(message);
  });

  it('should reject a truncated .3tz', async function () {
    const archive = buildArchive([{ name: 'tileset.json', content: validTileset }]);
    const truncated = Buffer.concat([archive.subarray(0, 40), archive.subarray(archive.length - 120)]);

    await expect(reader.readModelPolygon(await write('model.3tz', truncated))).rejects.toThrow(AppError);
  });

  it('should reject a .3tz whose tileset is not valid json', async function () {
    const archive = buildArchive([{ name: 'tileset.json', content: 'not json', method: COMPRESSION_DEFLATED }]);

    await expect(reader.readModelPolygon(await write('model.3tz', archive))).rejects.toThrow(ERROR_TILESET_INVALID);
  });
});
