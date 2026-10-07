import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { describe, it, expect } from 'vitest';
import { extractMetadata, calculateBoundingBox } from '@src/extractor/shapefileMetadata';
import { ERROR_METADATA_NO_FEATURES, ERROR_NOT_POLYGON, ERROR_PRODUCT_SINGLE_FEATURE } from '@src/extractor/constants';
import type { ExtractedMetadata } from '@src/extractor/interfaces';

const square = (x: number, y: number, size = 0.01): Geometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});

const collection = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const feature = (geometry: Geometry, properties: Record<string, unknown> = {}): Feature => ({ type: 'Feature', geometry, properties });

const part = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  prodID: 'AFL',
  prodName: 'afula',
  dateStart: new Date(2025, 6, 6),
  dateEnd: new Date(2025, 6, 8),
  minResM: 0.5,
  maxResM: 1,
  absCep90: 2.5,
  absLep90: 3,
  relCep90: 1,
  sensors: 'OTHER',
  srsId: '4326',
  srsName: 'WGS84GEO',
  producer: 'IDFMU',
  prodSys: 'sys',
  prodVer: '1',
  prodDate: new Date(2025, 6, 10),
  ...overrides,
});

const product = collection([feature(square(35, 32, 0.5))]);

const extract = (parts: Record<string, unknown>[]): ExtractedMetadata => {
  const result = extractMetadata(product, collection(parts.map((properties, index) => feature(square(35.28 + index * 0.01, 32.6), properties))));
  if (!result.success) {
    throw new Error(result.errors.join('; '));
  }
  return result.data;
};

const errorsOf = (productCollection: FeatureCollection, metadataCollection: FeatureCollection): string[] => {
  const result = extractMetadata(productCollection, metadataCollection);
  return result.success ? [] : result.errors;
};

describe('extractMetadata', function () {
  it('should aggregate every part according to the mapping rules', function () {
    const { core, aggregation } = extract([
      part(),
      part({
        dateStart: new Date(2025, 6, 5),
        dateEnd: new Date(2025, 6, 9),
        minResM: 0.3,
        maxResM: 2,
        absCep90: 4,
        absLep90: 2,
        relCep90: 0.5,
        relLep90: 2.5,
        sensors: 'UAV, OTHER',
        prodDate: new Date(2025, 6, 11),
      }),
    ]);

    expect(core).toEqual({
      productId: 'AFL',
      productName: 'afula',
      srsId: '4326',
      srsName: 'WGS84GEO',
      producerName: 'IDFMU',
      productionSystem: 'sys',
      productionSystemVersion: '1',
      productionDate: '2025-07-11T00:00:00.000Z',
    });
    expect(aggregation).toEqual({
      footprint: product.features[0]?.geometry,
      imagingTimeBeginUTC: new Date('2025-07-05T00:00:00.000Z'),
      imagingTimeEndUTC: new Date('2025-07-09T00:00:00.000Z'),
      minResolutionMeter: 0.3,
      maxResolutionMeter: 2,
      maxAbsoluteAccuracyCEP90: 4,
      maxAbsoluteAccuracyLEP90: 3,
      maxAbsoluteAccuracySEP90: undefined,
      maxRelativeAccuracyCEP90: 1,
      maxRelativeAccuracyLEP90: 2.5,
      maxRelativeAccuracySEP90: undefined,
      sensors: ['OTHER', 'UAV'],
      productBoundingBox: '35,32,35.5,32.5',
    });
  });

  it('should accept ISO date strings and numeric srsId', function () {
    const { core, aggregation } = extract([part({ dateStart: '2025-07-01T00:00:00.000Z', srsId: 4326 })]);

    expect(core.srsId).toBe('4326');
    expect(aggregation.imagingTimeBeginUTC).toEqual(new Date('2025-07-01T00:00:00.000Z'));
  });

  it('should require exactly one polygonal product feature', function () {
    const metadata = collection([feature(square(35.28, 32.6), part())]);

    expect(errorsOf(collection([]), metadata)).toEqual([ERROR_PRODUCT_SINGLE_FEATURE]);
    expect(errorsOf(collection([feature(square(1, 1)), feature(square(2, 2))]), metadata)).toEqual([ERROR_PRODUCT_SINGLE_FEATURE]);
    expect(errorsOf(collection([feature({ type: 'Point', coordinates: [1, 1] })]), metadata)).toEqual([`Product feature: ${ERROR_NOT_POLYGON}`]);
  });

  it('should require at least one metadata feature', function () {
    expect(errorsOf(product, collection([]))).toEqual([ERROR_METADATA_NO_FEATURES]);
  });

  it('should report every invalid attribute with its feature index and short name', function () {
    const metadata = collection([
      feature(square(35.28, 32.6), part()),
      feature(
        {
          type: 'LineString',
          coordinates: [
            [1, 1],
            [2, 2],
          ],
        },
        part({ dateEnd: null, minResM: 'abc', prodDate: 'not a date', producer: ' ' })
      ),
    ]);

    expect(errorsOf(product, metadata)).toEqual([
      `ShapeMetadata feature 2: ${ERROR_NOT_POLYGON}`,
      'ShapeMetadata feature 2: dateEnd is mandatory',
      'ShapeMetadata feature 2: producer is mandatory',
      'ShapeMetadata feature 2: minResM must be a number',
      'ShapeMetadata feature 2: prodDate must be a valid date',
    ]);
  });

  it('should reject a date stored as a number', function () {
    const metadata = collection([feature(square(35.28, 32.6), part({ dateStart: 20250706 }))]);

    expect(errorsOf(product, metadata)).toEqual(['ShapeMetadata feature 1: dateStart must be a valid date']);
  });

  it('should reject a part whose minimum resolution is greater than its maximum', function () {
    const metadata = collection([feature(square(35.28, 32.6), part({ minResM: 3, maxResM: 1 }))]);

    expect(errorsOf(product, metadata)).toEqual(['ShapeMetadata feature 1: minResM must not be greater than maxResM']);
  });

  it('should reject a part whose imaging start is after its end', function () {
    const metadata = collection([feature(square(35.28, 32.6), part({ dateStart: new Date(2025, 6, 9), dateEnd: new Date(2025, 6, 8) }))]);

    expect(errorsOf(product, metadata)).toEqual(['ShapeMetadata feature 1: dateStart must not be later than dateEnd']);
  });

  it('should reject an optional accuracy that is not a number', function () {
    const metadata = collection([feature(square(35.28, 32.6), part({ relSep90: 'x' }))]);

    expect(errorsOf(product, metadata)).toEqual(['ShapeMetadata feature 1: relSep90 must be a number']);
  });

  it('should require directly mapped attributes to be identical across parts', function () {
    const metadata = collection([
      feature(square(35.28, 32.6), part()),
      feature(square(35.29, 32.6), part({ prodID: 'OTHER', srsName: 'OTHER', prodSys: 'other' })),
    ]);

    expect(errorsOf(product, metadata)).toEqual([
      'ShapeMetadata: prodID must be identical across all features',
      'ShapeMetadata: srsName must be identical across all features',
      'ShapeMetadata: prodSys must be identical across all features',
    ]);
  });
});

describe('calculateBoundingBox', function () {
  it('should compute the bbox of a multipolygon', function () {
    const geometry = {
      type: 'MultiPolygon' as const,
      coordinates: [(square(1, 1) as { coordinates: number[][][] }).coordinates, (square(3, 4) as { coordinates: number[][][] }).coordinates],
    };

    expect(calculateBoundingBox(geometry)).toBe('1,1,3.01,4.01');
  });
});
