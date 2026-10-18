import type { Feature } from 'geojson';
import { SHAPE_METADATA_FIELDS } from './constants';
import type { ExtractionResult } from './interfaces';
import { isEmpty, toUtcDate } from './utils';

const SHAPE_FIELDS = SHAPE_METADATA_FIELDS;
const MANDATORY_FIELDS = Object.values(SHAPE_FIELDS);

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
      productId: String(properties[SHAPE_FIELDS.prodID]).trim(),
      productName: String(properties[SHAPE_FIELDS.prodName]).trim(),
      srsId: String(properties[SHAPE_FIELDS.srsId]).trim(),
      srsName: String(properties[SHAPE_FIELDS.srsName]).trim(),
      producerName: String(properties[SHAPE_FIELDS.producer]).trim(),
      productionSystem: String(properties[SHAPE_FIELDS.prodSys]).trim(),
      productionSystemVersion: String(properties[SHAPE_FIELDS.prodVer]).trim(),
      productionDate: productionDate.toISOString(),
    },
  };
};

export { extractCommonMetadata };
