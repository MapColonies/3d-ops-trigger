import { LAYER_3D_PRODUCT_TYPE_LIST } from '@map-colonies/3d-shared';

export const buildValidPayload = (): Record<string, unknown> => ({
  modelPath: '\\\\domtest\\models\\paris\\data\\tileset.json',
  productShapefilePath: '\\\\domtest\\models\\paris\\shape\\Product.shp',
  metadataShapefilePath: '\\\\domtest\\models\\paris\\shape\\ShapeMetadata.shp',
  productType: LAYER_3D_PRODUCT_TYPE_LIST[0],
  classification: 'abc123',
  region: ['France'],
});

export const buildProductIdentity = (): { productId: string; productName: string } => ({
  productId: 'p-1',
  productName: 'paris',
});
