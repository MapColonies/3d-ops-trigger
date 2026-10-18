import type { Feature } from 'geojson';
import { describe, it, expect } from 'vitest';
import { extractCommonMetadata } from '@src/extractor/shapefileMetadata';

const feature = (properties: Record<string, unknown> = {}): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [35, 32] },
  properties,
});

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  prodID: 'AFL',
  prodName: 'afula',
  srsId: '4326',
  srsName: 'WGS84GEO',
  producer: 'IDFMU',
  prodSys: 'sys',
  prodVer: '1',
  prodDate: { year: 2025, month: 7, day: 10 },
  ...overrides,
});

const errorsOf = (properties: Record<string, unknown>): string[] => {
  const result = extractCommonMetadata(feature(properties));
  return result.success ? [] : result.errors;
};

describe('extractCommonMetadata', function () {
  it('should map the common attributes of the first row', function () {
    const result = extractCommonMetadata(feature(row()));

    expect(result).toEqual({
      success: true,
      data: {
        productId: 'AFL',
        productName: 'afula',
        srsId: '4326',
        srsName: 'WGS84GEO',
        producerName: 'IDFMU',
        productionSystem: 'sys',
        productionSystemVersion: '1',
        productionDate: '2025-07-10T00:00:00.000Z',
      },
    });
  });

  it('should trim the text attributes it maps', function () {
    const result = extractCommonMetadata(feature(row({ prodID: ' AFL ', prodName: 'afula  ' })));

    expect(result).toMatchObject({ success: true, data: { productId: 'AFL', productName: 'afula' } });
  });

  it('should accept an ISO date string and a numeric srsId', function () {
    const result = extractCommonMetadata(feature(row({ prodDate: '2025-07-10T00:00:00.000Z', srsId: 4326 })));

    expect(result).toMatchObject({ success: true, data: { srsId: '4326', productionDate: '2025-07-10T00:00:00.000Z' } });
  });

  it('should report every missing common attribute', function () {
    expect(errorsOf(row({ prodName: ' ', producer: null, prodSys: undefined }))).toEqual([
      'ShapeMetadata: prodName is mandatory',
      'ShapeMetadata: producer is mandatory',
      'ShapeMetadata: prodSys is mandatory',
    ]);
  });

  it('should report all attributes as missing when the feature has no properties', function () {
    expect(errorsOf({})).toHaveLength(8);
  });

  it('should reject a production date that is not a valid date', function () {
    expect(errorsOf(row({ prodDate: 'not a date' }))).toEqual(['ShapeMetadata: prodDate must be a valid date']);
  });

  it('should reject a production date stored as a number', function () {
    expect(errorsOf(row({ prodDate: 20250710 }))).toEqual(['ShapeMetadata: prodDate must be a valid date']);
  });
});
