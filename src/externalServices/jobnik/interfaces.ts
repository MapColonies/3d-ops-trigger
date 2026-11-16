import type { InsertRecordTask, RecordMetadata, Stages3D, StageType3D } from '@map-colonies/3d-shared';

export interface IngestionJobInput {
  modelId: string;
  productId: string;
  productName: string;
  modelPath: string;
  metadataShapefilePath: string;
  metadata: RecordMetadata;
  footprint: InsertRecordTask['footprint'];
  region: string[];
}

export type StagePlan = {
  [Type in StageType3D]: { type: Type; task?: Stages3D[Type]['task']['data'] };
}[StageType3D];

export interface ProductKey {
  productId: string;
  productName: string;
}
