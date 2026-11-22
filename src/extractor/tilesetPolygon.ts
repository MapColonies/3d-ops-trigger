import { ellipse, bboxPolygon } from '@turf/turf';
import proj4 from 'proj4';
import type { BBox, Polygon } from 'geojson';
import { ERROR_BAD_FORMAT_TILESET, ERROR_BOX_TILESET, PROJECTIONS } from './constants';
import type { BoundingRegion, BoundingSphere, TileSetJson } from './interfaces';

const METERS_IN_KILOMETER = 1000;
const DEGREES_IN_HALF_TURN = 180;
const REGION_BBOX_LENGTH = 4;

export const convertSphereFromXYZToWGS84 = (shape: BoundingSphere): Polygon => {
  const [lon, lat, , radiusMeters] = proj4(PROJECTIONS.sphere).inverse<number[]>(shape.sphere) as [number, number, number, number];
  const radius = radiusMeters / METERS_IN_KILOMETER;
  return ellipse([lon, lat], radius, radius, {}).geometry;
};

export const convertRegionFromRadianToDegrees = (shape: BoundingRegion): Polygon => {
  const radianToDegree = DEGREES_IN_HALF_TURN / Math.PI;
  const coord = shape.region.slice(0, REGION_BBOX_LENGTH).map((value) => value * radianToDegree);
  return bboxPolygon(coord as BBox).geometry;
};

export const calculatePolygonFromTileset = (tileSetJson: TileSetJson): Polygon => {
  const shape = tileSetJson.root.boundingVolume;
  if (shape.sphere !== undefined) {
    return convertSphereFromXYZToWGS84(shape as BoundingSphere);
  }
  if (shape.region !== undefined) {
    return convertRegionFromRadianToDegrees(shape as BoundingRegion);
  }
  if (shape.box !== undefined) {
    throw new Error(ERROR_BOX_TILESET);
  }
  throw new Error(ERROR_BAD_FORMAT_TILESET);
};
