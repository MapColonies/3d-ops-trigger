import type { ExtractedMetadata } from '../extractor/interfaces';

export interface ShapefileFiles {
  shp: string;
  shx: string;
  dbf: string;
  prj: string;
  cpg: string;
}

export interface IngestionFiles {
  modelPath: string;
  product: ShapefileFiles;
  metadata: ShapefileFiles;
}

export type ProductIdentity = Pick<ExtractedMetadata, 'productId' | 'productName'>;
