import { LAYER_3D_PRODUCT_TYPE_LIST } from '@map-colonies/3d-shared';

export const buildValidFormFields = (): Record<string, unknown> => ({
  productType: LAYER_3D_PRODUCT_TYPE_LIST[0],
  classification: 'abc123',
  region: ['ישראל'],
});

export const buildProductIdentity = (): { productId: string; productName: string } => ({
  productId: 'p-1',
  productName: 'afula',
});
