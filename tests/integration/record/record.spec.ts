import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, beforeAll } from 'vitest';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { initConfig } from '@src/common/config';
import type { IngestionPayload } from '@src/record/models/recordManager';

const ingestionPayload: IngestionPayload = {
  modelPath: '/shared/models/afula/data/tileset.json',
  productShapefilePath: '/shared/models/afula/shape/Product.shp',
  metadataShapefilePath: '/shared/models/afula/shape/ShapeMetadata.shp',
  productType: '3DPhotoRealistic',
  classification: '4',
  region: ['israel'],
};

describe('record', function () {
  let requestSender: RequestSender<paths, operations>;

  beforeAll(async function () {
    await initConfig(true);
  });

  beforeEach(async function () {
    const [app] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
  });

  describe('POST /record', function () {
    it.each(['modelPath', 'productShapefilePath', 'metadataShapefilePath', 'productType', 'classification', 'region'] as const)(
      'should return 400 when the required field %s is missing',
      async function (field) {
        const requestBody: Partial<IngestionPayload> = { ...ingestionPayload };
        delete requestBody[field];

        const response = await requestSender.createRecord({ requestBody: requestBody as IngestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', expect.stringContaining(field));
      }
    );

    it.each([
      ['productType is not in the enum', { productType: 'NOT_A_3D_TYPE' }, 'productType'],
      ['region is empty', { region: [] }, 'region'],
      ['region is not an array', { region: 'israel' }, 'region'],
      ['region contains a non string', { region: [1] }, 'region'],
      ['classification has invalid characters', { classification: '4-a' }, 'classification'],
      ['modelPath is not a string', { modelPath: 123 }, 'modelPath'],
      ['productSubType is not a string', { productSubType: 5 }, 'productSubType'],
    ])('should return 400 when %s', async function (_case, override, field) {
      const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, ...override } as IngestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', expect.stringContaining(field));
    });

    it.each([
      ['an unknown field', { unknownField: 'x' }],
      ['productName', { productName: 'afula' }],
      ['productId', { productId: 'afula-1' }],
    ])('should return 400 when %s is sent', async function (_case, extraField) {
      const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, ...extraField } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', 'request/body must NOT have additional properties');
    });

    it('should return 400 when the body is empty', async function () {
      const response = await requestSender.createRecord({ requestBody: {} as IngestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 when the metadata fails validation', async function () {
      const response = await requestSender.createRecord({ requestBody: ingestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', expect.stringContaining('productId'));
    });
  });

  describe('DELETE /record/{id}', function () {
    it('should return 200 and a job response', async function () {
      const response = await requestSender.deleteRecord({ pathParams: { id: 'rec-1' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);

      const body = response.body as paths['/record/{id}']['delete']['responses']['200']['content']['application/json'];

      expect(body.jobId).toBeTypeOf('string');
    });
  });

  describe('PATCH /record/{id}', function () {
    it('should return 200 and an ack for a metadata update', async function () {
      const response = await requestSender.updateRecord({ pathParams: { id: 'rec-1' }, requestBody: { description: 'updated' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.message).toBeTypeOf('string');
    });

    it('should return 400 when the body is not an object', async function () {
      const response = await requestSender.updateRecord({
        pathParams: { id: 'rec-1' },
        requestBody: ['description'] as unknown as Record<string, never>,
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });
  });

  describe('PATCH /record/status/{id}', function () {
    it('should return 200 and an ack for a valid status change', async function () {
      const response = await requestSender.updateRecordStatus({ pathParams: { id: 'rec-1' }, requestBody: { status: 'PUBLISHED' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);
    });

    it('should return 400 for an invalid status value', async function () {
      const response = await requestSender.updateRecordStatus({
        pathParams: { id: 'rec-1' },
        // @ts-expect-error intentionally invalid status enum value
        requestBody: { status: 'NOT_A_STATUS' },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 when the status is missing', async function () {
      const response = await requestSender.updateRecordStatus({
        pathParams: { id: 'rec-1' },
        requestBody: {} as { status: 'PUBLISHED' },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', expect.stringContaining('status'));
    });
  });
});
