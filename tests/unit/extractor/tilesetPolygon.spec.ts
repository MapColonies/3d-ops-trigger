import { describe, it, expect } from 'vitest';
import { calculatePolygonFromTileset } from '@src/extractor/tilesetPolygon';
import { ERROR_BAD_FORMAT_TILESET, ERROR_BOX_TILESET } from '@src/extractor/constants';
import type { TileSetJson } from '@src/extractor/interfaces';

describe('calculatePolygonFromTileset', () => {
  it('should convert a region bounding volume (radians) to a WGS84 polygon', () => {
    const tileset: TileSetJson = {
      root: { boundingVolume: { region: [0, 0, 0.1, 0.1, 0, 100] } },
    };

    const polygon = calculatePolygonFromTileset(tileset);

    expect(polygon.type).toBe('Polygon');

    const [ring = []] = polygon.coordinates;

    expect(ring.length).toBeGreaterThanOrEqual(5);

    const lons = ring.map(([lon]) => lon ?? Number.NaN);
    const lats = ring.map(([, lat]) => lat ?? Number.NaN);

    expect(Math.min(...lons)).toBeCloseTo(0, 5);
    expect(Math.max(...lons)).toBeCloseTo(5.729578, 3);
    expect(Math.max(...lats)).toBeCloseTo(5.729578, 3);
  });

  it('should convert a sphere bounding volume to a closed WGS84 polygon', () => {
    const tileset: TileSetJson = {
      root: { boundingVolume: { sphere: [4437589, 3079759, 3287656, 1000] } },
    };

    const polygon = calculatePolygonFromTileset(tileset);

    expect(polygon.type).toBe('Polygon');

    const [ring = []] = polygon.coordinates;

    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(ring.at(0)).toEqual(ring.at(-1));
  });

  it('should throw for an unsupported box bounding volume', () => {
    const tileset: TileSetJson = {
      root: { boundingVolume: { box: [0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100] } },
    };

    expect(() => calculatePolygonFromTileset(tileset)).toThrow(ERROR_BOX_TILESET);
  });

  it('should throw for a bounding volume with no recognised shape', () => {
    const tileset = { root: { boundingVolume: {} } } as TileSetJson;

    expect(() => calculatePolygonFromTileset(tileset)).toThrow(ERROR_BAD_FORMAT_TILESET);
  });
});
