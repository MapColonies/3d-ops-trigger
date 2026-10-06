import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const validPaths = {
  modelPath: 'afula/data/tileset.json',
  productShapefilePath: 'afula/shape/Product.shp',
  metadataShapefilePath: 'afula/shape/ShapeMetadata.shp',
};

describe('FilesValidator', function () {
  let basePath: string;
  let validator: FilesValidator;

  beforeEach(async function () {
    basePath = await mkdtemp(join(tmpdir(), 'ops-trigger-files-'));
    await cp(FIXTURE, join(basePath, 'afula'), { recursive: true });
    const configStub = { get: (): unknown => basePath } as unknown as ConfigType;
    validator = new FilesValidator(configStub, await jsLogger({ enabled: false }));
  });

  afterEach(async function () {
    await rm(basePath, { recursive: true, force: true });
  });

  it('should resolve all files for a valid tileset.json ingestion', async function () {
    const files = await validator.validateIngestionFiles(validPaths);

    expect(files.modelPath).toBe(join(basePath, 'afula/data/tileset.json'));
    expect(files.product).toEqual({
      shp: join(basePath, 'afula/shape/Product.shp'),
      shx: join(basePath, 'afula/shape/Product.shx'),
      dbf: join(basePath, 'afula/shape/Product.dbf'),
      prj: join(basePath, 'afula/shape/Product.prj'),
      cpg: join(basePath, 'afula/shape/Product.cpg'),
    });
    expect(files.metadata.dbf).toBe(join(basePath, 'afula/shape/ShapeMetadata.dbf'));
  });

  it('should accept a valid .3tz model', async function () {
    await expect(validator.validateIngestionFiles({ ...validPaths, modelPath: 'afula/data/model.3tz' })).resolves.toBeDefined();
  });

  it('should accept a tileset nested deeper inside the data folder', async function () {
    await cp(join(basePath, 'afula/data/tileset.json'), join(basePath, 'afula/data/tiles/tileset.json'), { recursive: true });

    await expect(validator.validateIngestionFiles({ ...validPaths, modelPath: 'afula/data/tiles/tileset.json' })).resolves.toBeDefined();
  });

  it.each([
    ['modelPath', { modelPath: '../afula/data/tileset.json' }],
    ['productShapefilePath', { productShapefilePath: '../../etc/Product.shp' }],
  ])('should reject a %s outside the storage base path', async function (field, override) {
    await expect(validator.validateIngestionFiles({ ...validPaths, ...override })).rejects.toThrow(`${field}: ${ERROR_PATH_OUTSIDE_BASE}`);
  });

  it.each([
    [ERROR_MODEL_FORMAT, { modelPath: 'afula/data/model.zip' }],
    [ERROR_MODEL_NOT_IN_DATA, { modelPath: 'afula/tileset.json' }],
    [ERROR_SHAPEFILE_FORMAT, { productShapefilePath: 'afula/shape/Product.dbf' }],
    [ERROR_SHAPEFILE_NOT_IN_SHAPE, { metadataShapefilePath: 'afula/data/ShapeMetadata.shp' }],
    [ERROR_SHAPEFILES_DIFFERENT_FOLDERS, { metadataShapefilePath: 'other/shape/ShapeMetadata.shp' }],
  ])('should reject an invalid layout: %s', async function (message, override) {
    await expect(validator.validateIngestionFiles({ ...validPaths, ...override })).rejects.toThrow(message);
  });

  it('should list every missing file, including shapefile sidecars', async function () {
    await rm(join(basePath, 'afula/shape/Product.cpg'));
    await rm(join(basePath, 'afula/shape/ShapeMetadata.shx'));

    const promise = validator.validateIngestionFiles({ ...validPaths, modelPath: 'afula/data/missing.json' });

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow('missing files: afula/data/missing.json, afula/shape/Product.cpg, afula/shape/ShapeMetadata.shx');
  });

  it('should reject a projected (non WGS84 geographic) .prj', async function () {
    await writeFile(join(basePath, 'afula/shape/ShapeMetadata.prj'), UTM_PRJ);

    await expect(validator.validateIngestionFiles(validPaths)).rejects.toThrow(`ShapeMetadata.prj: ${ERROR_PRJ_NOT_WGS84}`);
  });

  it('should reject a non UTF-8 .cpg', async function () {
    await writeFile(join(basePath, 'afula/shape/Product.cpg'), 'ISO-8859-8');

    await expect(validator.validateIngestionFiles(validPaths)).rejects.toThrow(`Product.cpg: ${ERROR_CPG_NOT_UTF8}`);
  });

  it.each([
    ['not json', 'not json'],
    ['missing root', JSON.stringify({ asset: { version: '1.0' } })],
  ])('should reject an invalid tileset json (%s)', async function (_case, content) {
    await writeFile(join(basePath, 'afula/data/tileset.json'), content);

    await expect(validator.validateIngestionFiles(validPaths)).rejects.toThrow(ERROR_TILESET_INVALID);
  });

  it('should reject a .3tz that is not a zip archive', async function () {
    await writeFile(join(basePath, 'afula/data/model.3tz'), 'definitely not a zip');

    await expect(validator.validateIngestionFiles({ ...validPaths, modelPath: 'afula/data/model.3tz' })).rejects.toThrow(ERROR_3TZ_INVALID);
  });
});
