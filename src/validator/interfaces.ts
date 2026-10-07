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
