import type { MultiPolygon, Polygon } from 'geojson';

export interface ExtractedMetadata {
  productId: string;
  productName: string;
  srsId: string;
  srsName: string;
  producerName: string;
  productionSystem: string;
  productionSystemVersion: string;
  productionDate: string;
}

export interface GdalDate {
  year: number;
  month: number;
  day: number;
}

export type ProductFootprint = Polygon | MultiPolygon;

export type ExtractionResult = { success: true; data: ExtractedMetadata } | { success: false; errors: string[] };
