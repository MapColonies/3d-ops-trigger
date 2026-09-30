import type { Polygon, Position } from 'geojson';

const TWO_DIMENSIONS = 2;

export const is3tz = (modelPath: string): boolean => modelPath.toLowerCase().endsWith('.3tz');

export const buildModelFilePath = (modelPath: string, tilesetFilename: string): string =>
  is3tz(modelPath) ? modelPath : `${modelPath}/${tilesetFilename}`;

export const convertPolygonTo2DPolygon = (polygon: Polygon): Polygon => ({
  ...polygon,
  coordinates: polygon.coordinates.map((ring: Position[]) => ring.map((coordinate: Position) => coordinate.slice(0, TWO_DIMENSIONS))),
});
