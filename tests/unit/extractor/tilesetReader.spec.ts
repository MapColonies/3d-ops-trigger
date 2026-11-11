import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsLogger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TilesetTarget3tz } from '3d-tiles-tools';
import { AppError, ERROR_BAD_FORMAT_TILESET, ERROR_BOX_TILESET } from '@map-colonies/3d-shared';
import { TilesetReader } from '@src/extractor/tilesetReader';
import { ERROR_3TZ_INVALID, ERROR_3TZ_INVALID_PREFIX, ERROR_TILESET_INVALID, ERROR_TILESET_NOT_IN_ARCHIVE } from '@src/extractor/constants';

const FIXTURE_DATA = join(__dirname, '../../fixtures/ingestion/paris/data');
const PARIS_BBOX = [2.33, 48.85, 2.35, 48.87];

const tilesetWith = (boundingVolume: unknown): string => JSON.stringify({ asset: { version: '1.0' }, root: { boundingVolume, geometricError: 1 } });
const tilesetWithAsset = (asset: unknown): string =>
  JSON.stringify({ asset, root: { boundingVolume: { region: [0.04, 0.85, 0.041, 0.851, 0, 10] }, geometricError: 1 } });
const validTileset = tilesetWith({ region: [0.04, 0.85, 0.041, 0.851, 0, 10] });
const tile: [string, string] = ['tiles/0.b3dm', 'b3dm'];

describe('TilesetReader', function () {
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
    reader = new TilesetReader(await jsLogger({ enabled: false }));
    folder = await mkdtemp(join(tmpdir(), 'ops-trigger-tileset-'));
  });

  afterEach(async function () {
    await rm(folder, { recursive: true, force: true });
  });

  it.each(['tileset.json', 'model.3tz'])('should read the model polygon of the fixture %s', async function (fileName) {
    const polygon = await reader.readModelPolygon(join(FIXTURE_DATA, fileName));

    const positions = polygon.coordinates.flat();
    const longitudes = positions.map(([longitude]) => longitude as number);
    const latitudes = positions.map(([, latitude]) => latitude as number);
    const bbox = [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];

    bbox.forEach((value, index) => expect(value).toBeCloseTo(PARIS_BBOX[index] as number, 5));
  });

  it('should read the tileset.json at the root of a .3tz', async function () {
    const path = await writeArchive([['other.json', 'not json'], tile, ['tileset.json', validTileset]]);

    await expect(reader.readModelPolygon(path)).resolves.toMatchObject({ type: 'Polygon' });
  });

  it('should read the model polygon of a sphere bounding volume', async function () {
    const path = await write('tileset.json', tilesetWith({ sphere: [4201000, 171000, 4780000, 100] }));

    await expect(reader.readModelPolygon(path)).resolves.toMatchObject({ type: 'Polygon' });
  });

  it('should read a tileset regardless of its asset.version, which is checked by the validator', async function () {
    const path = await write('tileset.json', tilesetWithAsset({ version: '0.0' }));

    await expect(reader.readModelPolygon(path)).resolves.toMatchObject({ type: 'Polygon' });
  });

  it.each([
    ['tileset.json', async (): Promise<string> => write('tileset.json', 'not json')],
    ['.3tz', async (): Promise<string> => writeArchive([['tileset.json', 'not json'], tile])],
  ])('should reject with 400 a %s that is not valid json', async function (_case, path) {
    const promise = reader.readModelPolygon(await path());

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    await expect(promise).rejects.toThrow(`${ERROR_TILESET_INVALID}: the file is not valid JSON`);
  });

  it.each([
    ['a box', { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }, ERROR_BOX_TILESET],
    ['an unknown', { other: [1] }, ERROR_BAD_FORMAT_TILESET],
    ['a broken region', { region: 'not an array' }, `${ERROR_TILESET_INVALID}: could not calculate the model polygon from root.boundingVolume`],
  ])('should reject %s bounding volume', async function (_case, boundingVolume, message) {
    await expect(reader.readModelPolygon(await write('tileset.json', tilesetWith(boundingVolume)))).rejects.toThrow(message);
  });

  it('should reject a missing tileset file', async function () {
    await expect(reader.readModelPolygon(join(folder, 'tileset.json'))).rejects.toThrow('tileset.json: tileset is unreadable');
  });

  it.each([
    ['has no tileset.json', [tile]],
    ['has another json instead of tileset.json at its root', [['other.json', validTileset], tile]],
    ['has the tileset.json only in a sub folder', [['data/tileset.json', validTileset], tile]],
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

  it.each([['has a box bounding volume', tilesetWith({ box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }), ERROR_BOX_TILESET]])(
    'should reject a .3tz whose tileset %s',
    async function (_case, content, message) {
      await expect(reader.readModelPolygon(await writeArchive([['tileset.json', content]]))).rejects.toThrow(message);
    }
  );
});
