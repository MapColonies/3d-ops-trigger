import type { Feature } from 'geojson';
import { SHAPE_METADATA_FIELDS } from './constants';
import type { ExtractionResult, GdalDate } from './interfaces';

const SHAPE_FIELDS = SHAPE_METADATA_FIELDS;
const MANDATORY_FIELDS = Object.values(SHAPE_FIELDS);

const isEmpty = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const isGdalDate = (value: unknown): value is GdalDate =>
  typeof value === 'object' &&
  value !== null &&
  'year' in value &&
  'month' in value &&
  'day' in value &&
  [value.year, value.month, value.day].every((part) => Number.isInteger(part));

const toUtcDate = (value: unknown): Date | undefined => {
  if (isGdalDate(value)) {
    const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
};

const extractCommonMetadata = (feature: Feature): ExtractionResult => {
  const properties = feature.properties ?? {};
  const errors = MANDATORY_FIELDS.filter((field) => isEmpty(properties[field])).map((field) => `ShapeMetadata: ${field} is mandatory`);

  const productionDate = toUtcDate(properties[SHAPE_FIELDS.prodDate]);
  if (!isEmpty(properties[SHAPE_FIELDS.prodDate]) && productionDate === undefined) {
    errors.push(`ShapeMetadata: ${SHAPE_FIELDS.prodDate} must be a valid date`);
  }

  if (errors.length > 0 || productionDate === undefined) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      productId: String(properties[SHAPE_FIELDS.prodID]),
      productName: String(properties[SHAPE_FIELDS.prodName]),
      srsId: String(properties[SHAPE_FIELDS.srsId]),
      srsName: String(properties[SHAPE_FIELDS.srsName]),
      producerName: String(properties[SHAPE_FIELDS.producer]),
      productionSystem: String(properties[SHAPE_FIELDS.prodSys]),
      productionSystemVersion: String(properties[SHAPE_FIELDS.prodVer]),
      productionDate: productionDate.toISOString(),
    },
  };
};

export { extractCommonMetadata };
