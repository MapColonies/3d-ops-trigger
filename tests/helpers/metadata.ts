/* eslint-disable @typescript-eslint/no-magic-numbers */
import { LAYER_3D_PRODUCT_TYPE_LIST } from '@map-colonies/3d-shared';

export const buildValidMetadata = (): Record<string, unknown> => ({
  productId: 'p-1',
  productName: 'afula',
  productType: LAYER_3D_PRODUCT_TYPE_LIST[0],
  classification: 'abc123',
  srsId: '4326',
  srsName: 'WGS84GEO',
  region: ['ישראל'],
  producerName: 'IDFMU',
  productionSystem: 'sys',
  productionSystemVersion: '1',
  productionDate: '2025-07-08T11:26:00.000Z',
  footprint: {
    type: 'Polygon',
    coordinates: [
      [
        [35.17, 32.9],
        [35.18, 32.9],
        [35.18, 32.91],
        [35.17, 32.91],
        [35.17, 32.9],
      ],
    ],
  },
  imagingTimeBeginUTC: '2025-07-06T11:10:00.000Z',
  imagingTimeEndUTC: '2025-07-10T11:10:00.000Z',
});
