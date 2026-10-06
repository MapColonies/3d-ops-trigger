import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, beforeAll, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import type { InjectionObject } from '@common/dependencyRegistration';
import { initConfig } from '@src/common/config';
import type { IngestionPayload } from '@src/record/models/recordManager';
import { LookupTablesClient } from '@src/externalServices/lookupTables/lookupTablesClient';
import { CatalogClient } from '@src/externalServices/catalog/catalogClient';

const lookupStub = { getClassifications: vi.fn().mockResolvedValue(['4']) } as unknown as LookupTablesClient;
const catalogStub = { findRecords: vi.fn().mockResolvedValue([]) } as unknown as CatalogClient;

const validIngestionPayload: IngestionPayload = {
  modelPath: 'afula/data/tileset.json',
  productShapefilePath: 'afula/shape/Product.shp',
  metadataShapefilePath: 'afula/shape/ShapeMetadata.shp',
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

  const buildRequestSender = async (extraOverrides: InjectionObject<unknown>[]): Promise<RequestSender<paths, operations>> => {
    const [app] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        { token: LookupTablesClient, provider: { useValue: lookupStub } },
        { token: CatalogClient, provider: { useValue: catalogStub } },
        ...extraOverrides,
      ],
      useChild: true,
    });
    return createRequestSender<paths, operations>('openapi3.yaml', app);
  };

  beforeEach(async function () {
    requestSender = await buildRequestSender([]);
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
        requestBody: { modelPath: 'afula/data/tileset.json' },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 201 for a valid .3tz model', async function () {
      const response = await requestSender.createRecord({ requestBody: { ...validIngestionPayload, modelPath: 'afula/data/model.3tz' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.CREATED);
    });

    it('should return 400 when a model file does not exist', async function () {
      const response = await requestSender.createRecord({ requestBody: { ...validIngestionPayload, modelPath: 'afula/data/missing.json' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', 'missing files: afula/data/missing.json');
    });

    it('should return 400 when a path escapes the storage base path', async function () {
      const response = await requestSender.createRecord({ requestBody: { ...validIngestionPayload, modelPath: '../afula/data/tileset.json' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 when metadata fails business validation', async function () {
      const response = await requestSender.createRecord({ requestBody: { ...validIngestionPayload, classification: 'notInLookup' } });

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
