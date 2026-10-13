export const SHAPE_METADATA_FIELDS = {
  prodID: 'prodID',
  prodName: 'prodName',
  srsId: 'srsId',
  srsName: 'srsName',
  producer: 'producer',
  prodSys: 'prodSys',
  prodVer: 'prodVer',
  prodDate: 'prodDate',
} as const;

export const ERROR_METADATA_NO_FEATURES = 'ShapeMetadata shapefile must contain at least one feature';
export const ERROR_PRODUCT_SINGLE_FEATURE = 'product shapefile must contain a single feature';
export const ERROR_PRODUCT_GEOMETRY = 'product shapefile feature must be a Polygon or MultiPolygon';
export const SHAPEFILE_NO_FEATURES_MESSAGE = 'has no valid features or vertices';
