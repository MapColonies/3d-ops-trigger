import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, afterEach, afterAll, it, expect, beforeAll } from 'vitest';
import nock, { cleanAll, disableNetConnect, enableNetConnect } from 'nock';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { initConfig } from '@src/common/config';
import type { IngestionPayload } from '@src/record/models/recordManager';

const ingestionPayload: IngestionPayload = {
  modelPath: 'afula/data/tileset.json',
  productShapefilePath: 'afula/shape/Product.shp',
  metadataShapefilePath: 'afula/shape/ShapeMetadata.shp',
  productType: '3DPhotoRealistic',
  classification: '4',
  region: ['israel'],
};

const EXTERNAL_SERVICES_URL = 'http://127.0.0.1:8080';
const LOOKUP_DATA_PATH = '/lookup-tables/lookupData';

const mockLookupTables = (): void => {
  nock(EXTERNAL_SERVICES_URL)
    .persist()
    .get(`${LOOKUP_DATA_PATH}/classification`)
    .reply(httpStatusCodes.OK, [{ value: '4', translationCode: 'restricted' }])
    .get(`${LOOKUP_DATA_PATH}/countries`)
    .reply(httpStatusCodes.OK, [{ value: 'israel', translationCode: 'israel' }]);
};

const mockCatalogFind = (records: unknown[] = []): void => {
  nock(EXTERNAL_SERVICES_URL).persist().post('/metadata/find').reply(httpStatusCodes.OK, records);
};

describe('record', function () {
  let requestSender: RequestSender<paths, operations>;

  beforeAll(async function () {
    await initConfig(true);
    disableNetConnect();
    enableNetConnect((host) => !host.startsWith('127.0.0.1:8080'));
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

  afterEach(function () {
    cleanAll();
  });

  afterAll(function () {
    enableNetConnect();
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

    it.each([
      ['a tileset.json model', 'afula/data/tileset.json'],
      ['a .3tz model', 'afula/data/model.3tz'],
    ])('should return 201 and a job response for %s', async function (_case, modelPath) {
      mockLookupTables();
      mockCatalogFind();

      const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, modelPath } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.CREATED);

      const body = response.body as paths['/record']['post']['responses']['201']['content']['application/json'];

      expect(body.jobId).toBeTypeOf('string');
      expect(body.status).toBeTypeOf('string');
    });

    it('should return 400 when a model file does not exist', async function () {
      const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, modelPath: 'afula/data/missing.json' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', 'missing files: afula/data/missing.json');
    });

    it('should return 400 when a path escapes the storage base path', async function () {
      const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, modelPath: '../afula/data/tileset.json' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', expect.stringContaining('storage base path'));
    });

    it('should return 400 when the classification is not in the lookup table', async function () {
      mockLookupTables();
      mockCatalogFind();

      const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, classification: 'notInLookup' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', expect.stringContaining('classification is not a valid value'));
    });

    it('should return 400 when a region is not in the countries lookup table', async function () {
      mockLookupTables();
      mockCatalogFind();

      const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, region: ['israel', 'Atlantis'] } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', expect.stringContaining('region contains invalid values: Atlantis'));
    });

    it('should return 400 when the product already exists in the catalog', async function () {
      mockLookupTables();
      mockCatalogFind([{ id: 'existing', productId: 'AFL', productName: 'afula' }]);

      const response = await requestSender.createRecord({ requestBody: ingestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body).toHaveProperty('message', 'product id is not unique!');
    });

    it('should return 500 when the lookup-tables service is down', async function () {
      nock(EXTERNAL_SERVICES_URL).get(`${LOOKUP_DATA_PATH}/classification`).reply(httpStatusCodes.SERVICE_UNAVAILABLE);

      const response = await requestSender.createRecord({ requestBody: ingestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
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
