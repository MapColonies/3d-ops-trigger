/** ShapeMetadata.shp attribute short names (Confluence "Field Mapping Cross-Reference") */
export const SHAPE_METADATA_FIELDS = {
  dateStart: 'dateStart',
  dateEnd: 'dateEnd',
  minResM: 'minResM',
  maxResM: 'maxResM',
  absCep90: 'absCep90',
  absLep90: 'absLep90',
  absSep90: 'absSep90',
  relCep90: 'relCep90',
  relLep90: 'relLep90',
  relSep90: 'relSep90',
  sensors: 'sensors',
  srsId: 'srsId',
  srsName: 'srsName',
  producer: 'producer',
  prodSys: 'prodSys',
  prodVer: 'prodVer',
  prodDate: 'prodDate',
} as const;

export const ERROR_PRODUCT_SINGLE_FEATURE = 'Product shapefile must contain exactly one feature';
export const ERROR_METADATA_NO_FEATURES = 'ShapeMetadata shapefile must contain at least one feature';
export const ERROR_NOT_POLYGON = 'geometry must be a Polygon or MultiPolygon';
