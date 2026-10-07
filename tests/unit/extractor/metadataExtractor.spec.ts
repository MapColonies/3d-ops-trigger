import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppError } from '@map-colonies/3d-shared';
import { MetadataExtractor } from '@src/extractor/metadataExtractor';
import type { IngestionFiles, ShapefileFiles } from '@src/validator/interfaces';

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

  it('should extract and aggregate the fixture shapefiles', async function () {
    const { core, aggregation } = await extractor.extract(filesOf(FIXTURE));

    expect(core).toEqual({
      productId: 'AFL',
      productName: 'afula',
      srsId: '4326',
      srsName: 'WGS84GEO',
      producerName: 'IDFMU',
      productionSystem: 'sys',
      productionSystemVersion: '1',
      productionDate: '2025-07-10T00:00:00.000Z',
    });
    expect(aggregation).toMatchObject({
      footprint: { type: 'Polygon' },
      imagingTimeBeginUTC: new Date('2025-07-05T00:00:00.000Z'),
      imagingTimeEndUTC: new Date('2025-07-09T00:00:00.000Z'),
      minResolutionMeter: 0.3,
      maxResolutionMeter: 2,
      maxAbsoluteAccuracyCEP90: 4,
      maxAbsoluteAccuracyLEP90: 3,
      maxRelativeAccuracyCEP90: 1,
      maxRelativeAccuracyLEP90: 2.5,
      sensors: ['OTHER', 'UAV'],
      productBoundingBox: '35.28,32.6,35.3,32.62',
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
      await writeFile(join(folder, 'shape/Product.shp'), 'garbage');

      const promise = extractor.extract(filesOf(folder));

      await expect(promise).rejects.toThrow(AppError);
      await expect(promise).rejects.toThrow('Product.shp: shapefile is corrupted or unreadable');
    });
  });

  it('should throw a 400 AppError when the extracted metadata is invalid', async function () {
    const files = filesOf(FIXTURE);
    // the footprint shapefile used as parts metadata has none of the mandatory attributes
    const promise = extractor.extract({ ...files, metadata: files.product });

    await expect(promise).rejects.toThrow('ShapeMetadata feature 1: minResM is mandatory');
  });
});
