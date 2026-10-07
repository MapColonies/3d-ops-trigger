import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import { ERROR_METADATA_NO_FEATURES, ERROR_NOT_POLYGON, ERROR_PRODUCT_SINGLE_FEATURE, SHAPE_METADATA_FIELDS } from './constants';
import type { ExtractionResult } from './interfaces';

const F = SHAPE_METADATA_FIELDS;
const MANDATORY_NUMBERS = [F.minResM, F.maxResM, F.absCep90, F.absLep90] as const;
const OPTIONAL_NUMBERS = [F.absSep90, F.relCep90, F.relLep90, F.relSep90] as const;
const MANDATORY_DATES = [F.dateStart, F.dateEnd, F.prodDate] as const;
const MANDATORY_STRINGS = [F.prodID, F.prodName, F.sensors, F.srsId, F.srsName, F.producer, F.prodSys, F.prodVer] as const;
const UNIFORM_STRINGS = [F.prodID, F.prodName, F.srsId, F.srsName, F.producer, F.prodSys, F.prodVer] as const;
const SENSORS_SEPARATOR = ',';

type Properties = Record<string, unknown>;

const isPolygonal = (geometry: Geometry | null): geometry is Polygon | MultiPolygon =>
  geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';

const isEmpty = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const toUtcDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
};

const featureLabel = (index: number): string => `ShapeMetadata feature ${index + 1}`;

const validateFeature = (feature: Feature, index: number): string[] => {
  const errors: string[] = [];
  const properties = feature.properties ?? {};
  const label = featureLabel(index);

  if (!isPolygonal(feature.geometry)) {
    errors.push(`${label}: ${ERROR_NOT_POLYGON}`);
  }
  for (const field of [...MANDATORY_NUMBERS, ...MANDATORY_DATES, ...MANDATORY_STRINGS]) {
    if (isEmpty(properties[field])) {
      errors.push(`${label}: ${field} is mandatory`);
    }
  }
  for (const field of [...MANDATORY_NUMBERS, ...OPTIONAL_NUMBERS]) {
    const value: unknown = properties[field];
    if (!isEmpty(value) && (typeof value !== 'number' || !Number.isFinite(value))) {
      errors.push(`${label}: ${field} must be a number`);
    }
  }
  for (const field of MANDATORY_DATES) {
    if (!isEmpty(properties[field]) && toUtcDate(properties[field]) === undefined) {
      errors.push(`${label}: ${field} must be a valid date`);
    }
  }

  const minResolution = properties[F.minResM];
  const maxResolution = properties[F.maxResM];
  if (typeof minResolution === 'number' && typeof maxResolution === 'number' && minResolution > maxResolution) {
    errors.push(`${label}: ${F.minResM} must not be greater than ${F.maxResM}`);
  }

  const dateStart = toUtcDate(properties[F.dateStart]);
  const dateEnd = toUtcDate(properties[F.dateEnd]);
  if (dateStart !== undefined && dateEnd !== undefined && dateStart > dateEnd) {
    errors.push(`${label}: ${F.dateStart} must not be later than ${F.dateEnd}`);
  }
  return errors;
};

const validateUniformValues = (propertiesList: Properties[]): string[] =>
  UNIFORM_STRINGS.filter((field) => new Set(propertiesList.map((properties) => String(properties[field]))).size > 1).map(
    (field) => `ShapeMetadata: ${field} must be identical across all features`
  );

const collectPositions = (geometry: Polygon | MultiPolygon): Position[] =>
  geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat().flat();

const calculateBoundingBox = (geometry: Polygon | MultiPolygon): string => {
  const positions = collectPositions(geometry);
  const xs = positions.map((position) => position[0] as number);
  const ys = positions.map((position) => position[1] as number);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].join(',');
};

const numbersOf = (propertiesList: Properties[], field: string): number[] =>
  propertiesList.map((properties) => properties[field]).filter((value): value is number => typeof value === 'number');

const maxOf = (propertiesList: Properties[], field: string): number | undefined => {
  const values = numbersOf(propertiesList, field);
  return values.length > 0 ? Math.max(...values) : undefined;
};

const datesOf = (propertiesList: Properties[], field: string): number[] =>
  propertiesList.map((properties) => (toUtcDate(properties[field]) as Date).getTime());

const distinctSensors = (propertiesList: Properties[]): string[] => [
  ...new Set(
    propertiesList.flatMap((properties) =>
      String(properties[F.sensors])
        .split(SENSORS_SEPARATOR)
        .map((sensor) => sensor.trim())
        .filter((sensor) => sensor !== '')
    )
  ),
];

const extractMetadata = (product: FeatureCollection, shapeMetadata: FeatureCollection): ExtractionResult => {
  const errors: string[] = [];

  const [productFeature] = product.features;
  if (product.features.length !== 1 || productFeature === undefined) {
    errors.push(ERROR_PRODUCT_SINGLE_FEATURE);
  } else if (!isPolygonal(productFeature.geometry)) {
    errors.push(`Product feature: ${ERROR_NOT_POLYGON}`);
  }

  if (shapeMetadata.features.length === 0) {
    errors.push(ERROR_METADATA_NO_FEATURES);
  }
  errors.push(...shapeMetadata.features.flatMap(validateFeature));

  const propertiesList = shapeMetadata.features.map((feature) => feature.properties ?? {});
  if (errors.length === 0) {
    errors.push(...validateUniformValues(propertiesList));
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const footprint = (productFeature as Feature<Polygon | MultiPolygon>).geometry;
  const [first] = propertiesList as [Properties, ...Properties[]];

  return {
    success: true,
    data: {
      core: {
        productId: String(first[F.prodID]),
        productName: String(first[F.prodName]),
        srsId: String(first[F.srsId]),
        srsName: String(first[F.srsName]),
        producerName: String(first[F.producer]),
        productionSystem: String(first[F.prodSys]),
        productionSystemVersion: String(first[F.prodVer]),
        productionDate: new Date(Math.max(...datesOf(propertiesList, F.prodDate))).toISOString(),
      },
      aggregation: {
        footprint,
        imagingTimeBeginUTC: new Date(Math.min(...datesOf(propertiesList, F.dateStart))),
        imagingTimeEndUTC: new Date(Math.max(...datesOf(propertiesList, F.dateEnd))),
        minResolutionMeter: Math.min(...numbersOf(propertiesList, F.minResM)),
        maxResolutionMeter: Math.max(...numbersOf(propertiesList, F.maxResM)),
        maxAbsoluteAccuracyCEP90: Math.max(...numbersOf(propertiesList, F.absCep90)),
        maxAbsoluteAccuracyLEP90: Math.max(...numbersOf(propertiesList, F.absLep90)),
        maxAbsoluteAccuracySEP90: maxOf(propertiesList, F.absSep90),
        maxRelativeAccuracyCEP90: maxOf(propertiesList, F.relCep90),
        maxRelativeAccuracyLEP90: maxOf(propertiesList, F.relLep90),
        maxRelativeAccuracySEP90: maxOf(propertiesList, F.relSep90),
        sensors: distinctSensors(propertiesList),
        productBoundingBox: calculateBoundingBox(footprint),
      },
    },
  };
};

export { calculateBoundingBox, extractMetadata };
