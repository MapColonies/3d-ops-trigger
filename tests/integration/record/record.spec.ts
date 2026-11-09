import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { getConfig, initConfig, type LookupTablesConfig } from '@src/common/config';
import type { IngestionPayload } from '@src/record/models/recordManager';
import { JobnikClient } from '@src/externalServices/jobnik/jobnikClient';
import { ERROR_DELETE_RECORD_NOT_FOUND, ERROR_DELETE_STATUS, ERROR_PRODUCT_NAME_IN_FLIGHT } from '@src/validator/validationManager';

const ingestionPayload: IngestionPayload = {
  modelPath: '\\\\domtest\\models\\paris\\data\\tileset.json',
  productShapefilePath: '\\\\domtest\\models\\paris\\shape\\Product.shp',
  metadataShapefilePath: '\\\\domtest\\models\\paris\\shape\\ShapeMetadata.shp',
  productType: '3DPhotoRealistic',
  classification: '4',
  region: ['France'],
};

const deletableRecord = {
  id: 'rec-1',
  productId: 'PRS',
  productName: 'paris',
  productType: '3DPhotoRealistic',
  productVersion: 1,
  producerName: 'IDFMU',
  productStatus: 'UNPUBLISHED',
};

const jobnikStub = {
  createIngestionJob: vi.fn(),
  createDeleteJob: vi.fn(),
  hasInFlightIngestionJob: vi.fn(),
};

let lookupTables: LookupTablesConfig;
let catalogUrl: string;

const mockLookupTables = (): void => {
  nock(lookupTables.url)
    .persist()
    .get(`/${lookupTables.subUrl}/classification`)
    .reply(httpStatusCodes.OK, [{ value: '4', translationCode: 'restricted' }])
    .get(`/${lookupTables.subUrl}/countries`)
    .reply(httpStatusCodes.OK, [{ value: 'France', translationCode: 'france' }]);
};

const mockCatalogFind = (records: unknown[] = []): void => {
  nock(catalogUrl).persist().post('/metadata/find').reply(httpStatusCodes.OK, records);
};

describe('record', function () {
  let requestSender: RequestSender<paths, operations>;

  beforeAll(async function () {
    await initConfig(true);
    lookupTables = getConfig().get('externalServices.lookupTables');
    catalogUrl = getConfig().get('externalServices.catalogUrl');
    const externalHosts = [new URL(lookupTables.url).host, new URL(catalogUrl).host];
    nock.disableNetConnect();
    nock.enableNetConnect((host) => !externalHosts.includes(host));

    const [app] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        { token: JobnikClient, provider: { useValue: jobnikStub as unknown as JobnikClient } },
      ],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
  });

  beforeEach(function () {
    jobnikStub.createIngestionJob.mockReset().mockResolvedValue({ jobId: 'job-1', status: 'PENDING' });
    jobnikStub.createDeleteJob.mockReset().mockResolvedValue({ jobId: 'del-1', status: 'PENDING' });
    jobnikStub.hasInFlightIngestionJob.mockReset().mockResolvedValue(false);
  });

  afterEach(function () {
    nock.cleanAll();
  });

  describe('POST /record', function () {
    describe('Happy Path 🙂', function () {
      it.each([
        ['a tileset.json model', '\\\\domtest\\models\\paris\\data\\tileset.json'],
        ['a .3tz model', '\\\\domtest\\models\\paris\\data\\model.3tz'],
      ])('should return 201 and a job response for %s', async function (_case, modelPath) {
        mockLookupTables();
        mockCatalogFind();

        const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, modelPath } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.CREATED);
        expect(response.body).toEqual({ jobId: 'job-1', status: 'PENDING' });
        expect(jobnikStub.createIngestionJob).toHaveBeenCalledWith({
          modelPath,
          metadata: expect.objectContaining({
            productType: '3DPhotoRealistic',
            classification: '4',
            region: ['France'],
            productName: 'paris',
          }) as unknown,
        });
      });
    });

    describe('Bad Path 😡', function () {
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
        ["modelPath can't be empty", { modelPath: '' }, 'modelPath'],
        ["productShapefilePath can't be empty", { productShapefilePath: '' }, 'productShapefilePath'],
        ["metadataShapefilePath can't be empty", { metadataShapefilePath: '' }, 'metadataShapefilePath'],
        ['classification is empty', { classification: '' }, 'classification'],
        ['region is empty', { region: [] }, 'region'],
        ["a region value can't be empty", { region: ['France', ''] }, 'region/1'],
        ['the classification value is not in the lookup table', { classification: 'notInLookup' }, 'classification'],
        ['invalid region value', { region: ['invalid-region'] }, 'region'],
        ['region values must be unique', { region: ['France', 'France'] }, 'region'],
        ['invalid productType value', { productType: 'NOT_A_3D_TYPE' }, 'productType'],
        ['invalid classification value', { classification: '4-a' }, 'classification'],
      ])('should return 400 when %s', async function (_case, override, field) {
        mockLookupTables();

        const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, ...override } as IngestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', expect.stringContaining(field));
      });

      it.each([
        ['an unknown field', { unknownField: 'x' }],
        ['productName', { productName: 'paris' }],
        ['productId', { productId: 'paris-1' }],
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

      it('should return 400 when a model file does not exist', async function () {
        const response = await requestSender.createRecord({
          requestBody: { ...ingestionPayload, modelPath: '\\\\domtest\\models\\paris\\data\\missing.json' },
        });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', 'missing files: paris/data/missing.json');
      });

      it('should return 400 when a path is not under the base path', async function () {
        const response = await requestSender.createRecord({
          requestBody: { ...ingestionPayload, modelPath: '\\\\other\\share\\paris\\data\\tileset.json' },
        });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', expect.stringContaining("isn't in the agreed folder"));
      });

      it('should return 400 when the product already exists in the catalog', async function () {
        mockLookupTables();
        mockCatalogFind([{ id: 'existing', productId: 'PRS', productName: 'paris' }]);

        const response = await requestSender.createRecord({ requestBody: ingestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', 'product id is not unique!');
      });

      it('should return 409 when the product name already has an in-flight ingestion job', async function () {
        mockLookupTables();
        mockCatalogFind();
        jobnikStub.hasInFlightIngestionJob.mockResolvedValue(true);

        const response = await requestSender.createRecord({ requestBody: ingestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.CONFLICT);
        expect(response.body).toHaveProperty('message', ERROR_PRODUCT_NAME_IN_FLIGHT);
        expect(jobnikStub.createIngestionJob).not.toHaveBeenCalled();
      });
    });

    describe('Sad Path 😥', function () {
      it('should return 500 when the lookup-tables service is down', async function () {
        nock(lookupTables.url).get(`/${lookupTables.subUrl}/classification`).reply(httpStatusCodes.SERVICE_UNAVAILABLE);

        const response = await requestSender.createRecord({ requestBody: ingestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
      });

      it('should return 500 when the catalog service is down', async function () {
        mockLookupTables();
        nock(catalogUrl).post('/metadata/find').reply(httpStatusCodes.SERVICE_UNAVAILABLE);

        const response = await requestSender.createRecord({ requestBody: ingestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
      });
    });
  });

  describe('DELETE /record/{id}', function () {
    describe('Happy Path 🙂', function () {
      it('should return 200 and a job response', async function () {
        mockCatalogFind([deletableRecord]);

        const response = await requestSender.deleteRecord({ pathParams: { id: 'rec-1' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response.body).toEqual({ jobId: 'del-1', status: 'PENDING' });
        expect(jobnikStub.createDeleteJob).toHaveBeenCalledWith(deletableRecord);
      });
    });

    describe('Bad Path 😡', function () {
      it('should return 400 when the record does not exist', async function () {
        mockCatalogFind();

        const response = await requestSender.deleteRecord({ pathParams: { id: 'missing' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', ERROR_DELETE_RECORD_NOT_FOUND);
        expect(jobnikStub.createDeleteJob).not.toHaveBeenCalled();
      });

      it('should return 400 when the record is published', async function () {
        mockCatalogFind([{ ...deletableRecord, productStatus: 'PUBLISHED' }]);

        const response = await requestSender.deleteRecord({ pathParams: { id: 'rec-1' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', ERROR_DELETE_STATUS);
      });
    });

    describe('Sad Path 😥', function () {
      it('should return 500 when the catalog service is down', async function () {
        nock(catalogUrl).post('/metadata/find').reply(httpStatusCodes.SERVICE_UNAVAILABLE);

        const response = await requestSender.deleteRecord({ pathParams: { id: 'rec-1' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
      });
    });
  });

  describe('PATCH /record/{id}', function () {
    describe('Happy Path 🙂', function () {
      it('should return 200 and an ack for a metadata update', async function () {
        const response = await requestSender.updateRecord({ pathParams: { id: 'rec-1' }, requestBody: { description: 'updated' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response.body.message).toBeTypeOf('string');
      });
    });

    describe('Bad Path 😡', function () {
      it('should return 400 when the body is not an object', async function () {
        const response = await requestSender.updateRecord({
          pathParams: { id: 'rec-1' },
          requestBody: ['description'] as unknown as Record<string, never>,
        });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      });
    });
  });

  describe('PATCH /record/status/{id}', function () {
    describe('Happy Path 🙂', function () {
      it('should return 200 and an ack for a valid status change', async function () {
        const response = await requestSender.updateRecordStatus({ pathParams: { id: 'rec-1' }, requestBody: { status: 'PUBLISHED' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.OK);
      });
    });

    describe('Bad Path 😡', function () {
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
});
