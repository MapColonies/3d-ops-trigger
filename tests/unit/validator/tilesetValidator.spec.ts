import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsLogger, type Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TilesetTarget3tz } from '3d-tiles-tools';
import { Validators } from '3d-tiles-validator';
import { AppError } from '@map-colonies/3d-shared';
import { TilesetValidator } from '@src/validator/tilesetValidator';
import { TilesetReader } from '@src/extractor/tilesetReader';
import { ERROR_TILESET_ASSET_VERSION, ERROR_TILESET_VALIDATION_FAILED } from '@src/validator/constants';

const FIXTURE_DATA = join(__dirname, '../../fixtures/ingestion/paris/data');

describe('TilesetValidator', function () {
  let logger: Logger;
  let reader: TilesetReader;
  let validator: TilesetValidator;
  let folder: string;
  let validTileset: { asset: unknown; geometricError: number; root: { boundingVolume: unknown; geometricError: number } };

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

  const legacyChild = (): unknown => ({ boundingVolume: validTileset.root.boundingVolume, geometricError: 1, content: { url: 'tile.b3dm' } });

  beforeEach(async function () {
    logger = await jsLogger({ enabled: false });
    reader = new TilesetReader(logger);
    validator = new TilesetValidator(logger, reader);
    folder = await mkdtemp(join(tmpdir(), 'ops-trigger-validator-'));
    validTileset = JSON.parse(await readFile(join(FIXTURE_DATA, 'tileset.json'), 'utf-8')) as typeof validTileset;
  });

  afterEach(async function () {
    await rm(folder, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each(['tileset.json', 'model.3tz'])('should accept the fixture %s', async function (fileName) {
    await expect(validator.validate(join(FIXTURE_DATA, fileName))).resolves.toBeUndefined();
  });

  it('should accept a tileset with warnings only and log them', async function () {
    const warn = vi.spyOn(logger, 'warn');
    const path = await write('tileset.json', JSON.stringify({ ...validTileset, asset: { version: '2.0' } }));

    await expect(validator.validate(path)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ warnings: [expect.objectContaining({ type: 'ASSET_VERSION_UNKNOWN' })] }));
  });

  it('should reject with 400 naming the file, the problem and where it is', async function () {
    const promise = validator.validate(await write('tileset.json', JSON.stringify({ root: validTileset.root, asset: validTileset.asset })));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    await expect(promise).rejects.toThrow(
      `${ERROR_TILESET_VALIDATION_FAILED} for tileset.json: PROPERTY_MISSING: The 'geometricError' property is required (at /geometricError)`
    );
  });

  it.each([
    ['the asset', (): unknown => ({ ...validTileset, asset: undefined }), "PROPERTY_MISSING: The 'asset' property is required (at /asset)"],
    [
      'the asset.version',
      (): unknown => ({ ...validTileset, asset: {} }),
      "PROPERTY_MISSING: The 'version' property is required (at /asset/version)",
    ],
    [
      'the root.boundingVolume',
      (): unknown => ({ ...validTileset, root: { ...validTileset.root, boundingVolume: undefined } }),
      "PROPERTY_MISSING: The 'boundingVolume' property is required (at /root/boundingVolume)",
    ],
  ])('should reject with 400 a tileset without %s', async function (_case, tileset, problem) {
    const promise = validator.validate(await write('tileset.json', JSON.stringify(tileset())));

    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    await expect(promise).rejects.toThrow(problem);
  });

  it('should reject with 400 a tileset whose asset.version is not a string', async function () {
    const promise = validator.validate(await write('tileset.json', JSON.stringify({ ...validTileset, asset: { version: 1 } })));

    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    await expect(promise).rejects.toThrow("TYPE_MISMATCH: The 'version' property must have type 'string', but has type 'number' (at /asset/version)");
  });

  it.each(['1.0', '1.1', '1.2', '2.0', '10.3'])('should accept a tileset with asset.version %s', async function (version) {
    const path = await write('tileset.json', JSON.stringify({ ...validTileset, asset: { version } }));

    await expect(validator.validate(path)).resolves.toBeUndefined();
  });

  it.each([
    ['below 1.0', '0.0'],
    ['not a version', 'latest'],
  ])('should reject with 400 a tileset whose asset.version is %s and report the received value', async function (_case, version) {
    const promise = validator.validate(await write('tileset.json', JSON.stringify({ ...validTileset, asset: { version } })));

    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    await expect(promise).rejects.toThrow(
      `${ERROR_TILESET_VALIDATION_FAILED} for tileset.json: ASSET_VERSION_UNSUPPORTED: ${ERROR_TILESET_ASSET_VERSION}, received "${version}" (at /asset/version)`
    );
  });

  it('should report the old asset.version first together with the problems it causes', async function () {
    const legacyTileset = { ...validTileset, asset: { version: '0.0' }, root: { ...validTileset.root, content: { url: 'tile.b3dm' } } };
    const promise = validator.validate(await write('tileset.json', JSON.stringify(legacyTileset)));

    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    await expect(promise).rejects.toThrow(
      `${ERROR_TILESET_VALIDATION_FAILED} for tileset.json: ASSET_VERSION_UNSUPPORTED: ${ERROR_TILESET_ASSET_VERSION}, received "0.0" (at /asset/version); ` +
        "PROPERTY_MISSING: The 'uri' property is required (at /root/content/uri)"
    );
  });

  it('should reject with 400 a .3tz whose tileset asset.version is below 1.0', async function () {
    const promise = validator.validate(await writeArchive([['tileset.json', JSON.stringify({ ...validTileset, asset: { version: '0.0' } })]]));

    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    await expect(promise).rejects.toThrow(`ASSET_VERSION_UNSUPPORTED: ${ERROR_TILESET_ASSET_VERSION}, received "0.0" (at /asset/version)`);
  });

  it('should group a repeated problem with its count and first location', async function () {
    const children = [legacyChild(), legacyChild()];
    const promise = validator.validate(await write('tileset.json', JSON.stringify({ ...validTileset, root: { ...validTileset.root, children } })));

    await expect(promise).rejects.toThrow("PROPERTY_MISSING: The 'uri' property is required (2 times, first at /root/children/0/content/uri)");
  });

  it('should log every error with its type, message and path', async function () {
    const error = vi.spyOn(logger, 'error');
    const children = [legacyChild(), legacyChild()];
    const path = await write('tileset.json', JSON.stringify({ ...validTileset, root: { ...validTileset.root, children } }));

    await expect(validator.validate(path)).rejects.toThrow(ERROR_TILESET_VALIDATION_FAILED);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorsCount: 2,
        errors: [
          { type: 'PROPERTY_MISSING', message: "The 'uri' property is required", path: '/root/children/0/content/uri' },
          { type: 'PROPERTY_MISSING', message: "The 'uri' property is required", path: '/root/children/1/content/uri' },
        ],
      })
    );
  });

  it('should report every problem without truncating the list', async function () {
    const root = { boundingVolume: validTileset.root.boundingVolume, geometricError: 'y', refine: 'z' };
    const broken = { geometricError: 'x', extensionsUsed: ['vendorExtent'], extensions: { vendorExtent: 'x' }, root };
    const path = await write('tileset.json', JSON.stringify(broken));
    const { message } = await validator.validate(path).then(
      () => expect.fail('expected the validation to fail'),
      (err: unknown) => err as AppError
    );

    expect(message.split('; ')).toHaveLength(4);
    expect(message).not.toMatch(/more$/);
  });

  it('should reject a tileset with an extension that is not an object and point to it', async function () {
    const tileset = { ...validTileset, extensionsUsed: ['vendorExtent'], extensions: { vendorExtent: 'extent.geojson' } };
    const promise = validator.validate(await write('tileset.json', JSON.stringify(tileset)));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(
      "TYPE_MISMATCH: The 'vendorExtent' property must have type 'object', but has type 'string' (at /extensions/vendorExtent)"
    );
  });

  it('should not print an empty location for a problem without a path', async function () {
    const promise = validator.validate(await write('tileset.json', '{ "asset": '));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(`${ERROR_TILESET_VALIDATION_FAILED} for tileset.json: JSON_PARSE_ERROR`);
    await expect(promise).rejects.not.toThrow('()');
  });

  it.each([
    ['has no tileset.json', (): [string, string][] => [['tiles/0.b3dm', 'b3dm']]],
    ['has a valid tileset under another name at its root', (): [string, string][] => [['wrong_tileset.json', JSON.stringify(validTileset)]]],
    ['has the tileset.json only in a sub folder', (): [string, string][] => [['data/tileset.json', JSON.stringify(validTileset)]]],
  ] as [string, () => [string, string][]][])('should reject a .3tz that %s', async function (_case, entries) {
    const promise = validator.validate(await writeArchive(entries()));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(`${ERROR_TILESET_VALIDATION_FAILED} for model.3tz: CONTENT_VALIDATION_ERROR: The 3TZ index is not valid`);
    await expect(promise).rejects.not.toThrow('(at model.3tz)');
  });

  it('should reject a .3tz that is not a zip archive with 400 without exposing its folder', async function () {
    const promise = validator.validate(await write('model.3tz', 'not a zip'));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    await expect(promise).rejects.toThrow(`${ERROR_TILESET_VALIDATION_FAILED} for model.3tz: IO_ERROR`);
    await expect(promise).rejects.not.toThrow(folder);
  });

  it.each([
    ['tileset.json that is not valid json', async (): Promise<string> => write('tileset.json', '{ "asset": ')],
    ['.3tz that is not a zip archive', async (): Promise<string> => write('model.3tz', 'not a zip')],
  ])('should log a %s only once, from the validator', async function (_case, path) {
    const error = vi.spyOn(logger, 'error');

    await expect(validator.validate(await path())).rejects.toMatchObject({ status: StatusCodes.BAD_REQUEST });
    expect(error).toHaveBeenCalledOnce();

    const [[logged]] = error.mock.calls as [[{ logContext: { class: string } }]];

    expect(logged.logContext.class).toBe(TilesetValidator.name);
  });

  it('should not skip the asset.version check when reading the tileset fails unexpectedly', async function () {
    vi.spyOn(reader, 'readTileset').mockRejectedValue(
      new AppError('badRequest', StatusCodes.BAD_REQUEST, 'tileset.json: tileset is unreadable', true)
    );

    await expect(validator.validate(join(FIXTURE_DATA, 'tileset.json'))).rejects.toThrow('tileset.json: tileset is unreadable');
  });

  it('should reject with 500 when the validator itself fails', async function () {
    vi.spyOn(Validators, 'validateTilesetFile').mockRejectedValue(new Error('boom'));
    const promise = validator.validate(join(FIXTURE_DATA, 'tileset.json'));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toMatchObject({ status: StatusCodes.INTERNAL_SERVER_ERROR });
    await expect(promise).rejects.toThrow(
      `${ERROR_TILESET_VALIDATION_FAILED} for tileset.json: an unexpected error occurred while running the validator`
    );
  });
});
