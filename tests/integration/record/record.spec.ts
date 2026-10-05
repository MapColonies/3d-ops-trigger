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

const validIngestionPayload: IngestionPayload = {
  modelPath: '/shared/models/afula/data/tileset.json',
  productShapefilePath: '/shared/models/afula/shape/Product.shp',
  metadataShapefilePath: '/shared/models/afula/shape/ShapeMetadata.shp',
  productName: 'afula',
  productId: 'afula-1',
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
    it('should return 201 and a job response for a valid ingestion request', async function () {
      const response = await requestSender.createRecord({ requestBody: validIngestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.CREATED);

      const body = response.body as paths['/record']['post']['responses']['201']['content']['application/json'];

      expect(body.jobId).toBeTypeOf('string');
      expect(body.status).toBeTypeOf('string');
    });

    it('should return 400 when a required field is missing', async function () {
      const response = await requestSender.createRecord({
        // @ts-expect-error intentionally invalid: missing shapefile paths and metadata fields
        requestBody: { modelPath: '/shared/models/afula/data/tileset.json' },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
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
  });
});
