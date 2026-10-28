import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsLogger } from '@map-colonies/js-logger';
import { AppError } from '@map-colonies/3d-shared';
import * as gdal from 'gdal-async';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ConfigType } from '@src/common/config';
import { ProductReader } from '@src/extractor/productReader';
import { ERROR_PRODUCT_GEOMETRY, ERROR_PRODUCT_SINGLE_FEATURE } from '@src/extractor/constants';
import { createShapefile, square } from '@tests/helpers/shapefile';

const FIXTURE_SHAPE = join(__dirname, '../../fixtures/ingestion/afula/shape');

describe('ProductReader', function () {
  let reader: ProductReader;
  let folder: string;

  const createReader = async (maxVerticesPerChunk: number): Promise<ProductReader> => {
    const config = { get: (): number => maxVerticesPerChunk } as unknown as ConfigType;
    return new ProductReader(config, await jsLogger({ enabled: false }));
  };

  beforeEach(async function () {
    reader = await createReader(10000);
    folder = await mkdtemp(join(tmpdir(), 'ops-trigger-product-'));
  });

  afterEach(async function () {
    await rm(folder, { recursive: true, force: true });
  });

  it('should return the footprint geometry of a valid product shapefile', async function () {
    const geometry = await reader.read(join(FIXTURE_SHAPE, 'Product.shp'));

    expect(geometry.type).toBe('Polygon');
  });

  it('should reject a shapefile that holds more than one feature', async function () {
    const promise = reader.read(join(FIXTURE_SHAPE, 'ShapeMetadata.shp'));

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow(ERROR_PRODUCT_SINGLE_FEATURE);
  });

  it('should reject a shapefile without features', async function () {
    const path = join(folder, 'Product.shp');
    createShapefile(path, gdal.wkbPolygon, []);

    await expect(reader.read(path)).rejects.toThrow('Product.shp has no valid features or vertices');
  });

  it('should reject a feature that is not a polygon', async function () {
    const path = join(folder, 'Product.shp');
    createShapefile(path, gdal.wkbPoint, [new gdal.Point(35, 32)]);

    await expect(reader.read(path)).rejects.toThrow(ERROR_PRODUCT_GEOMETRY);
  });

  it('should accept a single feature that is larger than the vertex limit of a chunk', async function () {
    const smallChunkReader = await createReader(3);

    const geometry = await smallChunkReader.read(join(FIXTURE_SHAPE, 'Product.shp'));

    expect(geometry.type).toBe('Polygon');
  });

  it('should accept a single polygon feature that was written by another tool', async function () {
    const path = join(folder, 'Product.shp');
    createShapefile(path, gdal.wkbPolygon, [square(35, 32)]);

    const geometry = await reader.read(path);

    expect(geometry.type).toBe('Polygon');
  });

  it('should reject a corrupted shapefile', async function () {
    const path = join(folder, 'Product.shp');
    await writeFile(path, 'garbage');

    const promise = reader.read(path);

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow('Failed to read product shapefile: Product.shp');
  });
});
