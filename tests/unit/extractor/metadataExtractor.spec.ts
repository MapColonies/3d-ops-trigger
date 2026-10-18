import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsLogger } from '@map-colonies/js-logger';
import * as gdal from 'gdal-async';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppError } from '@map-colonies/3d-shared';
import { MetadataExtractor } from '@src/extractor/metadataExtractor';
import { ERROR_METADATA_NO_FEATURES } from '@src/extractor/constants';
import type { IngestionFiles, ShapefileFiles } from '@src/validator/interfaces';
import { createShapefile } from '@tests/helpers/shapefile';

const FIXTURE = join(__dirname, '../../fixtures/ingestion/afula');

const shapefile = (folder: string, name: string): ShapefileFiles => {
  const base = join(folder, 'shape', name);
  return { shp: `${base}.shp`, shx: `${base}.shx`, dbf: `${base}.dbf`, prj: `${base}.prj`, cpg: `${base}.cpg` };
};

const filesOf = (folder: string): IngestionFiles => ({
  modelPath: join(folder, 'data/tileset.json'),
  product: shapefile(folder, 'Product'),
  metadata: shapefile(folder, 'ShapeMetadata'),
});

describe('MetadataExtractor', function () {
  let extractor: MetadataExtractor;

  beforeEach(async function () {
    extractor = new MetadataExtractor(await jsLogger({ enabled: false }));
  });

  it('should extract the common metadata from the first row of the fixture shapefile', async function () {
    const metadata = await extractor.extract(filesOf(FIXTURE));

    expect(metadata).toEqual({
      productId: 'AFL',
      productName: 'afula',
      srsId: '4326',
      srsName: 'WGS84GEO',
      producerName: 'IDFMU',
      productionSystem: 'sys',
      productionSystemVersion: '1',
      productionDate: '2025-07-10T00:00:00.000Z',
    });
  });

  describe('with a corrupted shapefile', function () {
    let folder: string;

    beforeEach(async function () {
      folder = await mkdtemp(join(tmpdir(), 'ops-trigger-extract-'));
      await cp(FIXTURE, folder, { recursive: true });
    });

    afterEach(async function () {
      await rm(folder, { recursive: true, force: true });
    });

    it('should throw a 400 AppError naming the unreadable file', async function () {
      await writeFile(join(folder, 'shape/ShapeMetadata.shp'), 'garbage');

      const promise = extractor.extract(filesOf(folder));

      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toThrow('ShapeMetadata.shp: shapefile is corrupted or unreadable');
    });
  });

  it('should throw a 400 AppError when the metadata shapefile has no rows', async function () {
    const folder = await mkdtemp(join(tmpdir(), 'ops-trigger-empty-'));
    try {
      const empty = join(folder, 'ShapeMetadata.shp');
      createShapefile(empty, gdal.wkbPolygon, []);
      const files = filesOf(FIXTURE);

      const promise = extractor.extract({ ...files, metadata: { ...files.metadata, shp: empty } });

      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toThrow(ERROR_METADATA_NO_FEATURES);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('should throw a 400 AppError when the first row misses the common attributes', async function () {
    const files = filesOf(FIXTURE);
    const promise = extractor.extract({ ...files, metadata: files.product });

    await expect(promise).rejects.toThrow(AppError);
    await expect(promise).rejects.toThrow('ShapeMetadata: prodID is mandatory');
  });
});
