import type { InsertRecordTask, ShapeMetadataRow } from '@map-colonies/3d-shared';

export interface ShapefileFiles {
  shp: string;
  shx: string;
  dbf: string;
  prj: string;
  cpg: string;
}

export interface RelativePaths {
  modelPath: string;
  metadataShapefilePath: string;
}

export interface IngestionFiles {
  modelPath: string;
  product: ShapefileFiles;
  metadata: ShapefileFiles;
  relativePaths: RelativePaths;
}

export type ProductIdentity = Pick<ShapeMetadataRow, 'productId' | 'productName'>;

export interface IssueDetails {
  type: string;
  message: string;
  path: string;
}

export type Footprint = InsertRecordTask['footprint'];
