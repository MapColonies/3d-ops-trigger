import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bbox } from '@turf/turf';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TilesetTarget3tz } from '3d-tiles-tools';
import { AppError, ERROR_BAD_FORMAT_TILESET, ERROR_BOX_TILESET } from '@map-colonies/3d-shared';
import { TilesetReader } from '@src/extractor/tilesetReader';
import { ERROR_3TZ_INVALID, ERROR_3TZ_INVALID_PREFIX, ERROR_TILESET_INVALID, ERROR_TILESET_NOT_IN_ARCHIVE } from '@src/extractor/constants';

const FIXTURE_DATA = join(__dirname, '../../fixtures/ingestion/paris/data');
const PARIS_BBOX = [2.33, 48.85, 2.35, 48.87];

const tilesetWith = (boundingVolume: unknown): string => JSON.stringify({ asset: { version: '1.0' }, root: { boundingVolume, geometricError: 1 } });
const validTileset = tilesetWith({ region: [0.04, 0.85, 0.041, 0.851, 0, 10] });
const tile: [string, string] = ['tiles/0.b3dm', 'b3dm'];

describe('TilesetReader', function () {
  let logger: Logger;
  let reader: TilesetReader;
  let folder: string;

  const write = async (fileName: string, content: string | Buffer): Promise<string> => {
    const path = join(folder, fileName);
    await writeFile(path, content);
    return path;
  };

  const writeArchive = async (entries: [string, string][]): Promise<string> => {
    const path = join(folder, 'model.3tz');
    const target = new TilesetTarget3tz();
    await target.begin(path, true);
    for (const [name, content] of entries) {
      await target.addEntry(name, Buffer.from(content, 'utf-8'));
    }
    await target.end();
    return path;
  };

  beforeEach(async function () {
    logger = await jsLogger({ enabled: false });
    reader = new TilesetReader(logger);
    folder = await mkdtemp(join(tmpdir(), 'ops-trigger-tileset-'));
  });

  afterEach(async function () {
    await rm(folder, { recursive: true, force: true });
  });

  it.each(['tileset.json', 'model.3tz'])('should read the model polygon of the fixture %s', async function (fileName) {
    const polygon = await reader.readModelPolygon(join(FIXTURE_DATA, fileName));

    bbox(polygon).forEach((value, index) => expect(value).toBeCloseTo(PARIS_BBOX[index] as number, 5));
  });

  it('should read the tileset.json at the root of a .3tz', async function () {
    const path = await writeArchive([['other.json', 'not json'], tile, ['tileset.json', validTileset]]);

    await expect(reader.readModelPolygon(path)).resolves.toMatchObject({ type: 'Polygon' });
  });

  it('should fall back to the first root json in archive order when the .3tz has no tileset.json', async function () {
    const warn = vi.spyOn(logger, 'warn');
    const path = await writeArchive([['sub/a.json', 'not json'], ['b.json', validTileset], tile, ['a.json', 'not json']]);

    await expect(reader.readModelPolygon(path)).resolves.toMatchObject({ type: 'Polygon' });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ rootJsonNames: ['b.json', 'a.json'] }));
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
    ['has no json at its root', [tile]],
    ['has a json only in a sub folder', [['data/tileset.json', validTileset], tile]],
  ] as [string, [string, string][]][])('should reject a .3tz that %s', async function (_case, entries) {
    const promise = reader.readModelPolygon(await writeArchive(entries));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(ERROR_TILESET_NOT_IN_ARCHIVE);
  });

  it.each([
    ['is not a zip archive', Buffer.from('definitely not a zip')],
    ['is empty', Buffer.alloc(0)],
  ])('should reject a .3tz file that %s', async function (_case, content) {
    const promise = reader.readModelPolygon(await write('model.3tz', content));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(`${ERROR_3TZ_INVALID_PREFIX}: `);
  });

  it('should reject a missing .3tz file', async function () {
    await expect(reader.readModelPolygon(join(folder, 'model.3tz'))).rejects.toThrow(ERROR_3TZ_INVALID);
  });

  it.each([
    ['is not valid json', 'not json', ERROR_TILESET_INVALID],
    ['has a box bounding volume', tilesetWith({ box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }), ERROR_BOX_TILESET],
  ])('should reject a .3tz whose tileset %s', async function (_case, content, message) {
    await expect(reader.readModelPolygon(await writeArchive([['tileset.json', content]]))).rejects.toThrow(message);
  });
});
