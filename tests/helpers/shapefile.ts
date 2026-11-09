import * as gdal from 'gdal-async';

const WGS84_EPSG = 4326;

export const createShapefile = (path: string, geometryType: number, geometries: gdal.Geometry[]): void => {
  const dataset = gdal.drivers.get('ESRI Shapefile').create(path);
  const layer = dataset.layers.create('layer', gdal.SpatialReference.fromEPSG(WGS84_EPSG), geometryType);
  for (const geometry of geometries) {
    const feature = new gdal.Feature(layer);
    feature.setGeometry(geometry);
    layer.features.add(feature);
  }
  dataset.close();
};

export const square = (x: number, y: number): gdal.Polygon => {
  const ring = new gdal.LinearRing();
  for (const [px, py] of [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
    [x, y],
  ] as const) {
    ring.points.add(px, py);
  }
  const polygon = new gdal.Polygon();
  polygon.rings.add(ring);
  return polygon;
};
