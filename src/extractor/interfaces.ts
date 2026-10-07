import type { MultiPolygon, Polygon } from 'geojson';

export interface ExtractedCoreMetadata {
  productId: string;
  productName: string;
  srsId: string;
  srsName: string;
  producerName: string;
  productionSystem: string;
  productionSystemVersion: string;
  productionDate: string;
}

export interface ExtractedAggregationMetadata {
  footprint: Polygon | MultiPolygon;
  imagingTimeBeginUTC: Date;
  imagingTimeEndUTC: Date;
  minResolutionMeter: number;
  maxResolutionMeter: number;
  maxAbsoluteAccuracyCEP90: number;
  maxAbsoluteAccuracyLEP90: number;
  maxAbsoluteAccuracySEP90?: number;
  maxRelativeAccuracyCEP90?: number;
  maxRelativeAccuracyLEP90?: number;
  maxRelativeAccuracySEP90?: number;
  sensors: string[];
  productBoundingBox: string;
}

export interface ExtractedMetadata {
  core: ExtractedCoreMetadata;
  aggregation: ExtractedAggregationMetadata;
}

export type ExtractionResult = { success: true; data: ExtractedMetadata } | { success: false; errors: string[] };
