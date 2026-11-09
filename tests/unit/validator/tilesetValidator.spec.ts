import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TilesetTarget3tz } from '3d-tiles-tools';
import { AppError } from '@map-colonies/3d-shared';
import { ERROR_TILESET_VALIDATION_FAILED, TilesetValidator } from '@src/validator/tilesetValidator';

const FIXTURE_DATA = join(__dirname, '../../fixtures/ingestion/paris/data');

describe('TilesetValidator', function () {
  let logger: Logger;
  let validator: TilesetValidator;
  let folder: string;
  let validTileset: Record<string, unknown>;

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
    validator = new TilesetValidator(logger);
    folder = await mkdtemp(join(tmpdir(), 'ops-trigger-validator-'));
    validTileset = JSON.parse(await readFile(join(FIXTURE_DATA, 'tileset.json'), 'utf-8')) as Record<string, unknown>;
  });

  afterEach(async function () {
    await rm(folder, { recursive: true, force: true });
  });

  it.each(['tileset.json', 'model.3tz'])('should accept the fixture %s', async function (fileName) {
    await expect(validator.validate(join(FIXTURE_DATA, fileName))).resolves.toBeUndefined();
  });

  it('should reject with 400 a .3tz with a valid tileset under another name at its root', async function () {
    const promise = validator.validate(
      await writeArchive([
        ['tiles/0.b3dm', 'b3dm'],
        ['wrong_tileset.json', JSON.stringify(validTileset)],
      ])
    );

    await expect(promise).rejects.toThrow(`${ERROR_TILESET_VALIDATION_FAILED}: CONTENT_VALIDATION_ERROR`);
    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
  });

  it('should accept a tileset with warnings only and log them', async function () {
    const warn = vi.spyOn(logger, 'warn');
    const path = await write('tileset.json', JSON.stringify({ ...validTileset, asset: { version: 'unknown' } }));

    await expect(validator.validate(path)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ warnings: [expect.stringContaining('ASSET_VERSION_UNKNOWN')] }));
  });

  it('should reject a tileset that breaks the 3D Tiles schema', async function () {
    const { asset, root } = validTileset as { asset: unknown; root: { boundingVolume: unknown } };
    const promise = validator.validate(await write('tileset.json', JSON.stringify({ asset, root: { boundingVolume: root.boundingVolume } })));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(`${ERROR_TILESET_VALIDATION_FAILED}: PROPERTY_MISSING`);
  });

  it.each([
    ['has no tileset.json', [['tiles/0.b3dm', 'b3dm']]],
    ['has the tileset.json only in a sub folder', [['data/tileset.json', '{}']]],
  ] as [string, [string, string][]][])('should reject a .3tz that %s', async function (_case, entries) {
    const promise = validator.validate(await writeArchive(entries));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(`${ERROR_TILESET_VALIDATION_FAILED}: CONTENT_VALIDATION_ERROR`);
  });

  it('should reject a .3tz that is not a zip archive without exposing its folder', async function () {
    const promise = validator.validate(await write('model.3tz', 'not a zip'));

    await expect(promise).rejects.toThrow(`${ERROR_TILESET_VALIDATION_FAILED}: IO_ERROR`);
    await expect(promise).rejects.not.toThrow(folder);
  });

  it('should reject a missing tileset file', async function () {
    await expect(validator.validate(join(folder, 'tileset.json'))).rejects.toThrow(ERROR_TILESET_VALIDATION_FAILED);
  });
});
