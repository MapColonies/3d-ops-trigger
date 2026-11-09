import type { ShapeMetadataRow } from '@map-colonies/3d-shared';

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

export type ProductIdentity = Pick<ShapeMetadataRow, 'productId' | 'productName'>;
