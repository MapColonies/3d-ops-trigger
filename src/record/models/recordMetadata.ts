import type { RecordMetadata, ShapeMetadataRow } from '@map-colonies/3d-shared';
import type { IngestionPayload } from './recordManager';

export const toRecordMetadata = (row: ShapeMetadataRow, payload: IngestionPayload): RecordMetadata => ({
  productId: row.productId,
  productName: row.productName,
  productType: payload.productType,
  productSubType: payload.productSubType,
  description: payload.description,
  keywords: payload.keywords,
  classification: payload.classification,
  srsId: row.srsId,
  srsName: row.srsName,
  producerName: row.producerName,
  productionSystem: row.productionSystem,
  productionSystemVersion: row.productionSystemVersion,
  productionDate: row.productionDate,
  imagingTimeBeginUTC: row.imagingTimeBeginUTC,
  imagingTimeEndUTC: row.imagingTimeEndUTC,
  minResolutionMeter: row.minResolutionMeter,
  maxResolutionMeter: row.maxResolutionMeter,
  maxAbsoluteAccuracyCEP90: row.maxAbsoluteAccuracyCEP90,
  maxAbsoluteAccuracyLEP90: row.maxAbsoluteAccuracyLEP90,
  maxAbsoluteAccuracySEP90: row.maxAbsoluteAccuracySEP90,
  maxRelativeAccuracyCEP90: row.maxRelativeAccuracyCEP90,
  maxRelativeAccuracyLEP90: row.maxRelativeAccuracyLEP90,
  maxRelativeAccuracySEP90: row.maxRelativeAccuracySEP90,
  sensors: row.sensors,
});

export const toRegion = (row: ShapeMetadataRow, payload: IngestionPayload): string[] => [...new Set([...payload.region, ...row.countries])];
