import { chmod, cp, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppError } from '@map-colonies/3d-shared';
import type { ConfigType } from '@common/config';
import {
  FilesValidator,
  ERROR_3TZ_INVALID,
  ERROR_CPG_NOT_UTF8,
  ERROR_MODEL_FORMAT,
  ERROR_MODEL_NOT_IN_DATA,
  ERROR_PATH_OUTSIDE_BASE,
  ERROR_PRJ_NOT_WGS84,
  ERROR_SHAPEFILE_FORMAT,
  ERROR_SHAPEFILE_NOT_IN_SHAPE,
  ERROR_SHAPEFILES_DIFFERENT_FOLDERS,
  ERROR_TILESET_INVALID,
} from '@src/validator/filesValidator';

const FIXTURE = join(__dirname, '../../fixtures/ingestion/afula');
const UTM_PRJ = 'PROJCS["WGS_1984_UTM_Zone_36N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]]';
const ISRAEL_DATUM_PRJ =
  'GEOGCS["GCS_Israel",DATUM["D_Israel",SPHEROID["GRS_1980",6378137.0,298.257222101],TOWGS84[-48,55,52,0,0,0,0]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const OGC_WGS84_PRJ =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';

const SHARE_BASE_PATH = '\\\\domtest\\models';
const share = (relativePath: string): string => `${SHARE_BASE_PATH}\\${relativePath.replaceAll('/', '\\')}`;

const validPaths = {
  modelPath: share('afula/data/tileset.json'),
  productShapefilePath: share('afula/shape/Product.shp'),
  metadataShapefilePath: share('afula/shape/ShapeMetadata.shp'),
};

describe('FilesValidator', function () {
  let pvPath: string;
  let validator: FilesValidator;

  beforeEach(async function () {
    pvPath = await mkdtemp(join(tmpdir(), 'ops-trigger-files-'));
    await cp(FIXTURE, join(pvPath, 'afula'), { recursive: true });
    const settings: Record<string, string> = { 'paths.basePath': SHARE_BASE_PATH, 'paths.pvPath': pvPath };
    const configStub = { get: (key: string): unknown => settings[key] } as unknown as ConfigType;
    validator = new FilesValidator(configStub, await jsLogger({ enabled: false }));
  });

  afterEach(async function () {
    await rm(pvPath, { recursive: true, force: true });
  });

  it('should resolve all files for a valid tileset.json ingestion', async function () {
    const files = await validator.validateIngestionFiles(validPaths);

    expect(files.modelPath).toBe(join(pvPath, 'afula/data/tileset.json'));
    expect(files.product).toEqual({
      shp: join(pvPath, 'afula/shape/Product.shp'),
      shx: join(pvPath, 'afula/shape/Product.shx'),
      dbf: join(pvPath, 'afula/shape/Product.dbf'),
      prj: join(pvPath, 'afula/shape/Product.prj'),
      cpg: join(pvPath, 'afula/shape/Product.cpg'),
    });
    expect(files.metadata.dbf).toBe(join(pvPath, 'afula/shape/ShapeMetadata.dbf'));
  });

  it('should accept share paths written with forward slashes', async function () {
    const files = await validator.validateIngestionFiles({
      modelPath: '//domtest/models/afula/data/tileset.json',
      productShapefilePath: '//domtest/models/afula/shape/Product.shp',
      metadataShapefilePath: '//domtest/models/afula/shape/ShapeMetadata.shp',
    });

    expect(files.modelPath).toBe(join(pvPath, 'afula/data/tileset.json'));
  });

  it('should reject a path that is not under the base path', async function () {
    await expect(validator.validateIngestionFiles({ ...validPaths, modelPath: '\\\\other\\share\\afula\\data\\tileset.json' })).rejects.toThrow(
      `modelPath: ${ERROR_PATH_OUTSIDE_BASE}`
    );
  });

  it('should accept a valid .3tz model', async function () {
    await expect(validator.validateIngestionFiles({ ...validPaths, modelPath: share('afula/data/model.3tz') })).resolves.toBeDefined();
  });

  it('should accept a tileset nested deeper inside the data folder', async function () {
    await cp(join(pvPath, 'afula/data/tileset.json'), join(pvPath, 'afula/data/tiles/tileset.json'), { recursive: true });

    await expect(validator.validateIngestionFiles({ ...validPaths, modelPath: share('afula/data/tiles/tileset.json') })).resolves.toBeDefined();
  });

  it.each([
    ['modelPath', { modelPath: share('../afula/data/tileset.json') }],
    ['productShapefilePath', { productShapefilePath: share('../../etc/Product.shp') }],
  ])('should reject a %s that escapes the base path', async function (field, override) {
    await expect(validator.validateIngestionFiles({ ...validPaths, ...override })).rejects.toThrow(`${field}: ${ERROR_PATH_OUTSIDE_BASE}`);
  });

  it.each([
    [ERROR_MODEL_FORMAT, { modelPath: share('afula/data/model.zip') }],
    [ERROR_MODEL_NOT_IN_DATA, { modelPath: share('afula/tileset.json') }],
    [ERROR_SHAPEFILE_FORMAT, { productShapefilePath: share('afula/shape/Product.dbf') }],
    [ERROR_SHAPEFILE_NOT_IN_SHAPE, { metadataShapefilePath: share('afula/data/ShapeMetadata.shp') }],
    [ERROR_SHAPEFILES_DIFFERENT_FOLDERS, { metadataShapefilePath: share('other/shape/ShapeMetadata.shp') }],
  ])('should reject an invalid layout: %s', async function (message, override) {
    await expect(validator.validateIngestionFiles({ ...validPaths, ...override })).rejects.toThrow(message);
  });

  it('should list every missing file, including shapefile sidecars', async function () {
    await rm(join(pvPath, 'afula/shape/Product.cpg'));
    await rm(join(pvPath, 'afula/shape/ShapeMetadata.shx'));

    const promise = validator.validateIngestionFiles({ ...validPaths, modelPath: share('afula/data/missing.json') });

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow('missing files: afula/data/missing.json, afula/shape/Product.cpg, afula/shape/ShapeMetadata.shx');
  });

  it('should reject a projected (non WGS84 geographic) .prj', async function () {
    await writeFile(join(pvPath, 'afula/shape/ShapeMetadata.prj'), UTM_PRJ);

    await expect(validator.validateIngestionFiles(validPaths)).rejects.toThrow(`ShapeMetadata.prj: ${ERROR_PRJ_NOT_WGS84}`);
  });

  it('should reject a geographic .prj on a non WGS84 datum even when it has a TOWGS84 clause', async function () {
    await writeFile(join(pvPath, 'afula/shape/Product.prj'), ISRAEL_DATUM_PRJ);

    await expect(validator.validateIngestionFiles(validPaths)).rejects.toThrow(`Product.prj: ${ERROR_PRJ_NOT_WGS84}`);
  });

  it('should accept an OGC style WGS84 .prj', async function () {
    await writeFile(join(pvPath, 'afula/shape/Product.prj'), OGC_WGS84_PRJ);

    await expect(validator.validateIngestionFiles(validPaths)).resolves.toBeDefined();
  });

  it('should resolve upper case shapefile extensions with matching sidecars', async function () {
    const shapeFolder = join(pvPath, 'afula/shape');
    for (const file of await readdir(shapeFolder)) {
      const dot = file.lastIndexOf('.');
      await rename(join(shapeFolder, file), join(shapeFolder, `${file.slice(0, dot)}${file.slice(dot).toUpperCase()}`));
    }

    const files = await validator.validateIngestionFiles({
      ...validPaths,
      productShapefilePath: share('afula/shape/Product.SHP'),
      metadataShapefilePath: share('afula/shape/ShapeMetadata.SHP'),
    });

    expect(files.product.shp).toBe(join(pvPath, 'afula/shape/Product.SHP'));
    expect(files.product.cpg).toBe(join(pvPath, 'afula/shape/Product.CPG'));
  });

  it.skipIf(process.getuid?.() === 0)('should rethrow file system errors other than a missing file', async function () {
    const shapeFolder = join(pvPath, 'afula/shape');
    await chmod(shapeFolder, 0o000);

    try {
      await expect(validator.validateIngestionFiles(validPaths)).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      await chmod(shapeFolder, 0o755);
    }
  });

  it('should reject a non UTF-8 .cpg', async function () {
    await writeFile(join(pvPath, 'afula/shape/Product.cpg'), 'ISO-8859-8');

    await expect(validator.validateIngestionFiles(validPaths)).rejects.toThrow(`Product.cpg: ${ERROR_CPG_NOT_UTF8}`);
  });

  it.each([
    ['not json', 'not json'],
    ['missing root', JSON.stringify({ asset: { version: '1.0' } })],
  ])('should reject an invalid tileset json (%s)', async function (_case, content) {
    await writeFile(join(pvPath, 'afula/data/tileset.json'), content);

    await expect(validator.validateIngestionFiles(validPaths)).rejects.toThrow(ERROR_TILESET_INVALID);
  });

  it('should reject a .3tz that is not a zip archive', async function () {
    await writeFile(join(pvPath, 'afula/data/model.3tz'), 'definitely not a zip');

    await expect(validator.validateIngestionFiles({ ...validPaths, modelPath: share('afula/data/model.3tz') })).rejects.toThrow(ERROR_3TZ_INVALID);
  });
});
